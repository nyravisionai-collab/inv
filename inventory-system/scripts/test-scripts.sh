#!/usr/bin/env bash
# Regression tests for START.sh / STOP.sh / RUN.sh / scripts/install.sh.
#
# These exercise the failure modes that used to fail silently, by actually
# running the scripts rather than inspecting their source.
#
#   bash scripts/test-scripts.sh
#
# The suite starts and stops the real app, so it needs ports 5000/5173 free.
set -euo pipefail

__src=${BASH_SOURCE[0]}
while [ -L "$__src" ]; do
  __d=$(cd -P "$(dirname "$__src")" && pwd)
  __src=$(readlink "$__src")
  case $__src in /*) ;; *) __src="$__d/$__src" ;; esac
done
__dir=$(cd -P "$(dirname "$__src")" && pwd)
# shellcheck source=scripts/lib.sh
source "$__dir/lib.sh"
ROOT=$(cd -P "$__dir/.." && pwd)
cd "$ROOT"

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  %sPASS%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  %sFAIL%s %s\n' "$C_RED" "$C_RESET" "$1"; }
check() { if [ "$1" = "$2" ]; then ok "$3 (got $1)"; else bad "$3 — expected '$2', got '$1'"; fi; }

cleanup() { bash "$ROOT/STOP.sh" --quiet >/dev/null 2>&1 || true; }
trap cleanup EXIT

banner "Shell script regression tests"
cleanup

# --- 1. shellcheck ---------------------------------------------------------
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -x -s bash "$ROOT"/START.sh "$ROOT"/STOP.sh "$ROOT"/RUN.sh "$ROOT"/scripts/*.sh; then
    ok "shellcheck reports no issues"
  else
    bad "shellcheck reported issues"
  fi
else
  printf '  %sSKIP%s shellcheck not installed\n' "$C_YELLOW" "$C_RESET"
fi

# --- 2. --help works and exits 0 ------------------------------------------
for s in START.sh STOP.sh RUN.sh scripts/install.sh; do
  rc=0; bash "$ROOT/$s" --help >/dev/null 2>&1 || rc=$?
  check "$rc" 0 "$s --help exits 0"
done

# --- 3. Unknown option is rejected ----------------------------------------
rc=0; bash "$ROOT/START.sh" --nonsense >/dev/null 2>&1 || rc=$?
check "$rc" 1 "START.sh rejects an unknown option"

# --- 4. Runs from an unrelated working directory --------------------------
rc=0; ( cd / && bash "$ROOT/STOP.sh" --status >/dev/null 2>&1 ) || rc=$?
check "$rc" 0 "STOP.sh --status works from /"

# --- 5. Start, verify both services really serve traffic ------------------
rc=0; bash "$ROOT/START.sh" >/dev/null 2>&1 || rc=$?
check "$rc" 0 "START.sh starts cleanly"

PORT=$(env_value "$ROOT/backend/.env" PORT); PORT=${PORT:-5000}
if curl -sf --max-time 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  ok "backend answers /api/health"
else
  bad "backend does not answer /api/health"
fi
if port_in_use 5173; then ok "frontend listens on 5173"; else bad "frontend not listening"; fi

# PID files must name the real processes, not a wrapper.
if pid=$(read_pid "$ROOT" backend); then
  case $(proc_cmdline "$pid") in
    *src/server.js*) ok "backend PID file points at the real node process" ;;
    *) bad "backend PID file points at the wrong process" ;;
  esac
else
  bad "backend PID file missing or stale while running"
fi
if pid=$(read_pid "$ROOT" frontend); then
  case $(proc_cmdline "$pid") in
    *vite*) ok "frontend PID file points at the real vite process" ;;
    *) bad "frontend PID file points at the wrong process" ;;
  esac
else
  bad "frontend PID file missing or stale while running"
fi

# --- 6. Double start is refused -------------------------------------------
rc=0; bash "$ROOT/START.sh" >/dev/null 2>&1 || rc=$?
check "$rc" 4 "second START.sh refuses (exit 4) instead of killing the first"

# --- 7. Ports are reported busy -------------------------------------------
rc=0; bash "$ROOT/START.sh" --force >/dev/null 2>&1 || rc=$?
check "$rc" 0 "START.sh --force restarts a running instance"

# --- 8. STOP really stops both and frees the ports ------------------------
rc=0; bash "$ROOT/STOP.sh" >/dev/null 2>&1 || rc=$?
check "$rc" 0 "STOP.sh exits 0"
if port_in_use "$PORT"; then bad "port $PORT still in use after STOP"; else ok "port $PORT freed"; fi
if port_in_use 5173; then bad "port 5173 still in use after STOP"; else ok "port 5173 freed"; fi
if pgrep -f 'node src/server.js' >/dev/null 2>&1; then
  bad "a backend process survived STOP.sh"
else
  ok "no backend process survived STOP.sh"
fi

# --- 9. STOP on an already-stopped app is not an error --------------------
rc=0; bash "$ROOT/STOP.sh" >/dev/null 2>&1 || rc=$?
check "$rc" 0 "STOP.sh on a stopped app exits 0"

# --- 10. Stale PID file naming an unrelated process must not be killed ----
mkdir -p "$ROOT/.run"
sleep 120 &
victim=$!
printf '%s\nsrc/server.js\n' "$victim" > "$ROOT/.run/backend.pid"
bash "$ROOT/STOP.sh" >/dev/null 2>&1 || true
if kill -0 "$victim" 2>/dev/null; then
  ok "unrelated process with a recycled PID was NOT killed"
  kill "$victim" 2>/dev/null || true
else
  bad "STOP.sh killed an unrelated process"
fi
wait "$victim" 2>/dev/null || true
if [ -f "$ROOT/.run/backend.pid" ]; then
  bad "stale PID file was not cleaned up"
else
  ok "stale PID file cleaned up"
fi

# --- 11. Missing node is reported as exit 2 -------------------------------
fake=$(mktemp -d)
for c in bash sed grep awk cat cut tail head ls mkdir rm cp printf sleep ps \
         kill pgrep tr date chmod uname dirname basename readlink seq env rmdir wc; do
  p=$(command -v "$c" 2>/dev/null) && ln -sf "$p" "$fake/$c"
done
rc=0; PATH=$fake bash "$ROOT/START.sh" >/dev/null 2>&1 || rc=$?
check "$rc" 2 "START.sh reports missing node as exit 2"
rc=0; PATH=$fake bash "$ROOT/scripts/install.sh" >/dev/null 2>&1 || rc=$?
check "$rc" 2 "install.sh reports missing node as exit 2"
rm -rf "$fake"

# --- 12. install.sh is idempotent and non-destructive ---------------------
if [ -f "$ROOT/backend/.env" ]; then
  marker="# regression-test-marker-$$"
  printf '%s\n' "$marker" >> "$ROOT/backend/.env"
  db_before=''
  [ -f "$ROOT/backend/data/inventory.db" ] && db_before=$(cksum < "$ROOT/backend/data/inventory.db")
  bash "$ROOT/scripts/install.sh" --no-build >/dev/null 2>&1 || true
  if grep -qF "$marker" "$ROOT/backend/.env"; then
    ok "install.sh preserves an existing backend/.env"
  else
    bad "install.sh overwrote backend/.env"
  fi
  grep -vF "$marker" "$ROOT/backend/.env" > "$ROOT/backend/.env.tmp" \
    && mv "$ROOT/backend/.env.tmp" "$ROOT/backend/.env"
  if [ -n "$db_before" ]; then
    db_after=$(cksum < "$ROOT/backend/data/inventory.db")
    if [ "$db_before" = "$db_after" ]; then
      ok "install.sh leaves an existing database untouched"
    else
      bad "install.sh modified the existing database"
    fi
  fi
fi

# --- Summary ---------------------------------------------------------------
printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '%s✓ all %s checks passed%s\n\n' "$C_GREEN" "$PASS" "$C_RESET"
  exit 0
fi
printf '%s✗ %s of %s checks failed%s\n\n' "$C_RED" "$FAIL" "$((PASS + FAIL))" "$C_RESET"
exit 1
