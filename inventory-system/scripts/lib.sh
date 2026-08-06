#!/usr/bin/env bash
# Shared helpers for START.sh / STOP.sh / RUN.sh / scripts/install.sh.
#
# This file is meant to be sourced, never executed. Every caller is expected to
# have already run `set -euo pipefail`.
#
# Portability notes:
#   * Works on Termux (Android), Linux and macOS. No GNU-only flags are used
#     (macOS ships BSD sed/ps, Termux ships busybox-ish tools).
#   * Nothing here assumes a particular working directory; callers resolve the
#     project root once (following symlinks) and pass absolute paths around.

# ---------------------------------------------------------------------------
# Exit codes (documented in README.md so callers/CI can branch on them)
# ---------------------------------------------------------------------------
# These are referenced by the scripts that source this file, which shellcheck
# cannot see from here; SC2034 would otherwise flag every one of them.
# shellcheck disable=SC2034
{
  readonly EX_OK=0
  readonly EX_FAIL=1            # generic failure
  readonly EX_MISSING_DEP=2     # node/npm/etc. not installed
  readonly EX_PORT_BUSY=3       # a foreign process owns a required port
  readonly EX_ALREADY_RUNNING=4 # an instance of this app is already up
  readonly EX_START_FAILED=5    # a service was launched but never became healthy
  readonly EX_STOP_FAILED=6     # a process refused to die
}

# ---------------------------------------------------------------------------
# Output helpers. Colour is disabled when stdout is not a TTY or NO_COLOR is
# set, so log files and CI output stay readable.
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_DIM=''; C_BOLD=''
fi

log_step() { printf '%s→%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
log_ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
log_warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
log_info() { printf '%s  %s%s\n' "$C_DIM" "$*" "$C_RESET"; }
log_err()  { printf '%s✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; }

# die <exit-code> <message...>
die() {
  local code=$1; shift
  log_err "$@"
  exit "$code"
}

# Print a boxed banner.
banner() {
  printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"
  printf '%s%s%s\n' "$C_DIM" "------------------------------------------------------------" "$C_RESET"
}

# ---------------------------------------------------------------------------
# Environment detection
# ---------------------------------------------------------------------------
is_termux() {
  # ${PREFIX:-} keeps this safe under `set -u`, which the old script got wrong.
  case "${PREFIX:-}" in
    *com.termux*) return 0 ;;
  esac
  [ -d /data/data/com.termux/files/usr ]
}

platform_name() {
  if is_termux; then echo "Termux (Android)"; else uname -s; fi
}

# require_cmd <command> <human readable install hint>
require_cmd() {
  local cmd=$1 hint=$2
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_err "Required command '$cmd' was not found on your PATH."
    printf '  %s\n' "$hint" >&2
    return 1
  fi
  return 0
}

# Verify node exists and is new enough. Returns EX_MISSING_DEP on failure.
check_node() {
  local min_major=${1:-18} hint version major
  if is_termux; then
    hint="Install it with:  pkg install nodejs"
  elif [ "$(uname -s)" = "Darwin" ]; then
    hint="Install it with:  brew install node   (or see https://nodejs.org/)"
  else
    hint="Install it with:  sudo apt install nodejs npm   (or see https://nodejs.org/)"
  fi

  require_cmd node "$hint" || return $EX_MISSING_DEP
  require_cmd npm "$hint" || return $EX_MISSING_DEP

  version=$(node --version 2>/dev/null | sed 's/^v//')
  major=${version%%.*}
  if [ -z "$major" ] || ! [ "$major" -ge "$min_major" ] 2>/dev/null; then
    log_err "Node.js >= ${min_major} is required, but 'node' reports v${version:-unknown}."
    printf '  %s\n' "$hint" >&2
    return $EX_MISSING_DEP
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Port helpers
# ---------------------------------------------------------------------------

# port_in_use <port> -- true if something accepts TCP connections on loopback.
# Uses bash's /dev/tcp, which needs no extra package (Termux often lacks
# lsof/ss/netstat entirely).
port_in_use() {
  local port=$1
  # The connection attempt runs in a subshell so the descriptor dies with it.
  # (A bare `exec 3>&-` in this shell would apply its redirections to the
  # *current* shell permanently — including silencing stderr.)
  (exec 3<>"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
}

# port_owner <port> -- best-effort "PID (command)" describing who holds a port.
# Prints nothing when no tool is available; callers must handle an empty value.
port_owner() {
  local port=$1 out=''
  if command -v lsof >/dev/null 2>&1; then
    out=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -Fpc 2>/dev/null \
      | awk '/^p/{p=substr($0,2)} /^c/{print p" ("substr($0,2)")"; exit}')
  fi
  if [ -z "$out" ] && command -v ss >/dev/null 2>&1; then
    out=$(ss -ltnp 2>/dev/null | awk -v p=":$port\$" '$4 ~ p {print $NF; exit}' \
      | sed 's/users:((//; s/))$//; s/"//g')
  fi
  if [ -z "$out" ] && command -v fuser >/dev/null 2>&1; then
    out=$(fuser "$port"/tcp 2>/dev/null | tr -d ' ')
  fi
  printf '%s' "$out"
}

# wait_for_port_free <port> <timeout-seconds>
wait_for_port_free() {
  local port=$1 timeout=${2:-10} waited=0
  while port_in_use "$port"; do
    if [ "$waited" -ge "$((timeout * 10))" ]; then return 1; fi
    sleep 0.1
    waited=$((waited + 1))
  done
  return 0
}

# ---------------------------------------------------------------------------
# PID-file helpers.
#
# Each service gets its own file under .run/ containing two lines:
#     <pid>
#     <signature>
# The signature is a substring we expect to find in the process's command line.
# Verifying it before sending a signal is what stops a recycled PID from making
# STOP.sh kill an unrelated process (a real bug in the previous version).
# ---------------------------------------------------------------------------

run_dir() { printf '%s/.run' "$1"; }
pid_file() { printf '%s/.run/%s.pid' "$1" "$2"; }

# proc_cmdline <pid> -- command line of a PID, empty if it does not exist.
proc_cmdline() {
  local pid=$1
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null
  else
    ps -p "$pid" -o args= 2>/dev/null
  fi
}

# write_pid <root> <name> <pid> <signature>
write_pid() {
  local root=$1 name=$2 pid=$3 sig=$4
  mkdir -p "$(run_dir "$root")"
  printf '%s\n%s\n' "$pid" "$sig" > "$(pid_file "$root" "$name")"
}

# read_pid <root> <name> -- echoes the PID only if the process is alive AND its
# command line still matches the recorded signature. Otherwise echoes nothing
# and returns 1, so callers can report "stale PID file" instead of guessing.
read_pid() {
  local root=$1 name=$2 file pid sig cmdline
  file=$(pid_file "$root" "$name")
  [ -f "$file" ] || return 1

  # `read || [ -n ... ]` also accepts a final line with no trailing newline,
  # which the old `while read` loop silently dropped.
  { read -r pid || [ -n "$pid" ]; read -r sig || [ -n "$sig" ]; } < "$file" || true
  case ${pid:-} in
    ''|*[!0-9]*) return 1 ;;
  esac

  kill -0 "$pid" 2>/dev/null || return 1

  if [ -n "${sig:-}" ]; then
    cmdline=$(proc_cmdline "$pid")
    case $cmdline in
      *"$sig"*) ;;
      *) return 1 ;;   # PID was recycled by an unrelated process
    esac
  fi

  printf '%s' "$pid"
  return 0
}

clear_pid() { rm -f "$(pid_file "$1" "$2")"; }

# stop_pid <pid> <label> -- TERM, wait, then KILL. Returns non-zero if the
# process is still alive at the end.
stop_pid() {
  local pid=$1 label=$2 waited=0
  kill -0 "$pid" 2>/dev/null || return 0

  # Signal the whole process group when we can, so npm/sh wrappers take their
  # children (the real vite server) down with them.
  local pgid
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  if [ -n "$pgid" ] && [ "$pgid" = "$pid" ]; then
    kill -TERM "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi

  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge 100 ]; then   # 10s grace period
      log_warn "$label (PID $pid) ignored SIGTERM; sending SIGKILL."
      if [ -n "$pgid" ] && [ "$pgid" = "$pid" ]; then
        kill -KILL "-$pgid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
      else
        kill -KILL "$pid" 2>/dev/null || true
      fi
      sleep 0.5
      break
    fi
    sleep 0.1
    waited=$((waited + 1))
  done

  ! kill -0 "$pid" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Dependency installation
# ---------------------------------------------------------------------------

# dependency_lock_stamp <workspace-dir>
#
# node_modules being present is not enough after the app is updated: an older
# dependency tree can still have all of the few modules we probe below, while
# missing a newly added package or containing an incompatible React/Vite pair.
# Keep a tiny, ignored stamp beside node_modules and compare it to the checked
# in lock file. `cksum` is POSIX and is available in Termux, macOS and Linux.
dependency_lock_stamp() {
  local dir=$1 lock="$1/package-lock.json"
  [ -f "$lock" ] || return 1
  cksum < "$lock" | awk '{print $1 ":" $2}'
}

deps_lock_matches() {
  local dir=$1 stamp expected
  stamp="$dir/node_modules/.inventory-lock-stamp"
  expected=$(dependency_lock_stamp "$dir") || return 1
  [ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$expected" ]
}

write_deps_lock_stamp() {
  local dir=$1 expected
  expected=$(dependency_lock_stamp "$dir") || return 0
  printf '%s\n' "$expected" > "$dir/node_modules/.inventory-lock-stamp"
}

# deps_ok <workspace-dir> <required binary/module...> -- detects a complete,
# lockfile-matched install. The old check used AND between two modules, so a
# half-finished or stale `npm install` looked fine. Every probe must exist.
deps_ok() {
  local dir=$1; shift
  [ -d "$dir/node_modules" ] || return 1
  local probe
  for probe in "$@"; do
    [ -e "$dir/node_modules/$probe" ] || return 1
  done
  deps_lock_matches "$dir"
}

# ensure_deps <workspace-dir> <label> <npm install args...> -- installs when
# needed and verifies the result, so a partial *or stale* install cannot be
# mistaken for success.
ensure_deps() {
  local dir=$1 label=$2; shift 2
  local -a probes=() npm_args=()
  local seen_sep=0 arg
  for arg in "$@"; do
    if [ "$arg" = "--" ]; then seen_sep=1; continue; fi
    if [ "$seen_sep" -eq 0 ]; then probes+=("$arg"); else npm_args+=("$arg"); fi
  done

  if deps_ok "$dir" "${probes[@]}"; then
    log_ok "$label dependencies present"
    return 0
  fi

  if [ -d "$dir/node_modules" ]; then
    log_warn "$label dependencies are incomplete or do not match package-lock.json. Re-installing."
  else
    log_step "Installing $label dependencies (first run — this can take a few minutes)..."
  fi

  if ! (cd "$dir" && npm install "${npm_args[@]}"); then
    log_err "'npm install' failed for the $label ($dir)."
    printf '  Check your network connection, then retry. If it keeps failing:\n' >&2
    printf '    rm -rf %s/node_modules && npm install --prefix %s\n' "$dir" "$dir" >&2
    return $EX_MISSING_DEP
  fi

  # npm may refresh package-lock.json while resolving an older tree, so stamp
  # it only after npm has completed successfully.
  write_deps_lock_stamp "$dir"
  if ! deps_ok "$dir" "${probes[@]}"; then
    log_err "'npm install' finished but the $label is still missing required packages."
    printf '  Expected under %s/node_modules: %s\n' "$dir" "${probes[*]}" >&2
    return $EX_MISSING_DEP
  fi

  log_ok "$label dependencies installed"
  return 0
}

# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------

# detect_lan_ip -- first non-loopback, non-link-local IPv4 address, or empty.
detect_lan_ip() {
  local ip=''
  if command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 addr show 2>/dev/null \
      | awk '/inet / && $2 !~ /^127/ && $2 !~ /^169\.254/ {sub(/\/.*/,"",$2); print $2; exit}')
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [ -z "$ip" ] && command -v ifconfig >/dev/null 2>&1; then
    ip=$(ifconfig 2>/dev/null \
      | awk '/inet /{gsub(/addr:/,"",$2); if ($2 !~ /^127/ && $2 !~ /^169\.254/) {print $2; exit}}')
  fi
  if [ -z "$ip" ] && command -v ipconfig.exe >/dev/null 2>&1; then
    ip=$(ipconfig.exe | grep "IPv4 Address" | head -n 1 | awk '{print $NF}' | tr -d '\r')
  fi
  printf '%s' "$ip"
}

# env_value <env-file> <key> -- last value for KEY, or empty.
env_value() {
  local file=$1 key=$2
  [ -f "$file" ] || return 0
  grep "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2- || true
}

# env_default <env-file> <key> <value> -- append KEY=value only when absent.
# Never rewrites a value the user has customised.
env_default() {
  local file=$1 key=$2 value=$3
  if ! grep -q "^${key}=" "$file" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# tail_log <file> <lines> -- show the end of a log file to explain a failure.
tail_log() {
  local file=$1 lines=${2:-20}
  [ -f "$file" ] || return 0
  printf '\n%s----- last %s lines of %s -----%s\n' "$C_DIM" "$lines" "$file" "$C_RESET" >&2
  tail -n "$lines" "$file" >&2 || true
  printf '%s----- end of log -----%s\n\n' "$C_DIM" "$C_RESET" >&2
}
