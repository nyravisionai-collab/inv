#!/usr/bin/env bash
# Inventory Management System — stop backend + frontend and verify they died.
#
#   bash STOP.sh            stop both services
#   bash STOP.sh --status   report what is running, change nothing
#   bash STOP.sh --quiet    stop without the summary (used by START --force)
#   bash STOP.sh --help     usage
#
# Exit codes: 0 stopped (or already stopped) · 6 something refused to die
set -euo pipefail

# Resolve this script's real directory, following symlinks, so it can be run
# from anywhere (including via a symlink in ~/bin). This must be inline
# because it is what lets us find scripts/lib.sh in the first place.
__src=${BASH_SOURCE[0]}
while [ -L "$__src" ]; do
  __dir=$(cd -P "$(dirname "$__src")" && pwd)
  __src=$(readlink "$__src")
  case $__src in /*) ;; *) __src="$__dir/$__src" ;; esac
done
__dir=$(cd -P "$(dirname "$__src")" && pwd)
SCRIPT_PATH=$__src
# shellcheck source=scripts/lib.sh
source "$__dir/scripts/lib.sh"
ROOT=$__dir
cd "$ROOT"

QUIET=0
STATUS_ONLY=0
while [ $# -gt 0 ]; do
  case $1 in
    -q|--quiet) QUIET=1 ;;
    -s|--status) STATUS_ONLY=1 ;;
    -h|--help)
      sed -n '2,8p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'
      exit $EX_OK
      ;;
    *) die $EX_FAIL "Unknown option '$1'. Try: bash STOP.sh --help" ;;
  esac
  shift
done

ENV_FILE="$ROOT/backend/.env"
PORT=$(env_value "$ENV_FILE" PORT); PORT=${PORT:-5000}
FRONTEND_PORT=${FRONTEND_PORT:-5173}

SERVICES=(backend frontend)

# ---------------------------------------------------------------------------
# --status: report only
# ---------------------------------------------------------------------------
if [ "$STATUS_ONLY" -eq 1 ]; then
  banner "Inventory Management System — status"
  any=0
  for svc in "${SERVICES[@]}"; do
    if pid=$(read_pid "$ROOT" "$svc"); then
      printf '  %s✓%s %-9s running (PID %s)\n' "$C_GREEN" "$C_RESET" "$svc" "$pid"
      any=1
    elif [ -f "$(pid_file "$ROOT" "$svc")" ]; then
      printf '  %s!%s %-9s not running (stale PID file — run STOP.sh to clean up)\n' \
        "$C_YELLOW" "$C_RESET" "$svc"
    else
      printf '  %s·%s %-9s not running\n' "$C_DIM" "$C_RESET" "$svc"
    fi
  done
  printf '\n'
  for entry in "backend:$PORT" "frontend:$FRONTEND_PORT"; do
    label=${entry%%:*}; p=${entry##*:}
    if port_in_use "$p"; then
      owner=$(port_owner "$p")
      printf '  port %-5s in use%s\n' "$p" "${owner:+ by $owner}"
    else
      printf '  port %-5s free (%s)\n' "$p" "$label"
    fi
  done
  printf '\n'
  [ "$any" -eq 1 ] && exit $EX_OK
  exit $EX_OK
fi

# ---------------------------------------------------------------------------
# Stop
# ---------------------------------------------------------------------------
[ "$QUIET" -eq 1 ] || banner "Stopping Inventory Management System"

stopped_any=0
failed=0

for svc in "${SERVICES[@]}"; do
  file=$(pid_file "$ROOT" "$svc")
  if pid=$(read_pid "$ROOT" "$svc"); then
    if stop_pid "$pid" "$svc"; then
      [ "$QUIET" -eq 1 ] || log_ok "Stopped $svc (PID $pid)"
      stopped_any=1
      clear_pid "$ROOT" "$svc"
    else
      log_err "Could not stop $svc (PID $pid) — it is still alive."
      printf '  Try manually: kill -9 %s\n' "$pid" >&2
      failed=1
    fi
  elif [ -f "$file" ]; then
    # Either the process is gone, or the PID was recycled by something
    # unrelated. Either way we must NOT send a signal — the old script did,
    # and could kill a stranger's process.
    [ "$QUIET" -eq 1 ] || log_warn "$svc was not running (stale PID file removed)."
    clear_pid "$ROOT" "$svc"
  else
    [ "$QUIET" -eq 1 ] || log_info "$svc was not running."
  fi
done

# ---------------------------------------------------------------------------
# Verify: the ports must actually be free again. This is the confirmation the
# previous script never did — it printed "✓ Stopped" unconditionally.
# ---------------------------------------------------------------------------
verify_port() {
  local port=$1 label=$2 owner
  if wait_for_port_free "$port" 10; then
    [ "$QUIET" -eq 1 ] || log_ok "Port $port ($label) is free"
    return 0
  fi
  owner=$(port_owner "$port")
  log_err "Port $port ($label) is still in use${owner:+ by $owner}."
  printf '  Something outside this app may own it; check with: lsof -i :%s\n' "$port" >&2
  return 1
}

verify_port "$PORT" backend || failed=1
verify_port "$FRONTEND_PORT" frontend || failed=1

rmdir "$(run_dir "$ROOT")" 2>/dev/null || true

if [ "$failed" -ne 0 ]; then
  log_err "Shutdown incomplete — see the messages above."
  exit $EX_STOP_FAILED
fi

if [ "$QUIET" -eq 0 ]; then
  if [ "$stopped_any" -eq 1 ]; then
    printf '\n%s✓ Inventory Management System stopped.%s\n\n' "$C_GREEN" "$C_RESET"
  else
    printf '\n%s✓ Nothing was running — already stopped.%s\n\n' "$C_GREEN" "$C_RESET"
  fi
fi

exit $EX_OK
