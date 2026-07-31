#!/usr/bin/env bash
# Inventory Management System — start backend + frontend (no login, LAN ready).
#
# Runs on Termux (Android), Linux and macOS. Safe to run from any directory.
#
#   bash START.sh              start both services
#   bash START.sh --force      stop an existing instance first, then start
#   bash START.sh --foreground run in the foreground (Ctrl-C stops both)
#   bash START.sh --help       usage
#
# Exit codes: 0 ok · 2 missing dependency · 3 port busy · 4 already running
#             5 service failed to become healthy
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

FORCE=0
FOREGROUND=0
while [ $# -gt 0 ]; do
  case $1 in
    -f|--force) FORCE=1 ;;
    --foreground|--fg) FOREGROUND=1 ;;
    -h|--help)
      sed -n '2,13p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'
      exit $EX_OK
      ;;
    *) die $EX_FAIL "Unknown option '$1'. Try: bash START.sh --help" ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# 1. Toolchain
# ---------------------------------------------------------------------------
banner "Inventory Management System — starting"
log_info "Project:  $ROOT"
log_info "Platform: $(platform_name)"

check_node 18 || exit $EX_MISSING_DEP
log_ok "Node $(node --version) / npm $(npm --version)"

# ---------------------------------------------------------------------------
# 2. Directories and .env
# ---------------------------------------------------------------------------
mkdir -p "$ROOT/backend/data" "$ROOT/backend/backups" "$ROOT/backend/logs" "$ROOT/.run"
for sub in logos products avatars imports misc; do
  mkdir -p "$ROOT/backend/uploads/$sub"
done

ENV_FILE="$ROOT/backend/.env"
ENV_EXAMPLE="$ROOT/backend/.env.example"
if [ ! -f "$ENV_FILE" ]; then
  [ -f "$ENV_EXAMPLE" ] || die $EX_FAIL "Neither backend/.env nor backend/.env.example exists — the checkout looks incomplete."
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  log_ok "Created backend/.env from .env.example"
fi

# Fill in only the keys that are missing. Unlike the previous version this
# never rewrites a PORT/HOST the user deliberately changed.
env_default "$ENV_FILE" HOST 0.0.0.0
env_default "$ENV_FILE" PORT 5000
env_default "$ENV_FILE" LAN_ONLY 1
env_default "$ENV_FILE" HTTPS 0

PORT=$(env_value "$ENV_FILE" PORT); PORT=${PORT:-5000}
HOST=$(env_value "$ENV_FILE" HOST); HOST=${HOST:-0.0.0.0}
HTTPS=$(env_value "$ENV_FILE" HTTPS); HTTPS=${HTTPS:-0}
FRONTEND_PORT=${FRONTEND_PORT:-5173}

case $PORT in
  ''|*[!0-9]*) die $EX_FAIL "PORT in backend/.env is not a number: '$PORT'" ;;
esac
export PORT HOST

# ---------------------------------------------------------------------------
# 3. Dependencies (detects a half-finished npm install, unlike the old check)
# ---------------------------------------------------------------------------
ensure_deps "$ROOT/backend" "backend" \
  express sql.js dotenv helmet -- --no-optional --omit=optional || exit $EX_MISSING_DEP
ensure_deps "$ROOT/frontend" "frontend" \
  vite react .bin/vite -- || exit $EX_MISSING_DEP

# ---------------------------------------------------------------------------
# 4. Already-running / stale PID handling
# ---------------------------------------------------------------------------
RUNNING=()
for svc in backend frontend; do
  if pid=$(read_pid "$ROOT" "$svc"); then
    RUNNING+=("$svc:$pid")
  elif [ -f "$(pid_file "$ROOT" "$svc")" ]; then
    log_warn "Ignoring stale PID file for $svc (process is gone) — cleaning it up."
    clear_pid "$ROOT" "$svc"
  fi
done

if [ ${#RUNNING[@]} -gt 0 ]; then
  if [ "$FORCE" -eq 1 ]; then
    log_step "--force given; stopping the running instance first..."
    bash "$ROOT/STOP.sh" --quiet || die $EX_STOP_FAILED "Could not stop the running instance; refusing to start a second one."
  else
    log_err "The Inventory System is already running:"
    for entry in "${RUNNING[@]}"; do
      printf '    %s (PID %s)\n' "${entry%%:*}" "${entry##*:}" >&2
    done
    printf '\n  Open it:     http://localhost:%s\n' "$FRONTEND_PORT" >&2
    printf '  Restart it:  bash START.sh --force   (or: npm run restart)\n' >&2
    printf '  Stop it:     bash STOP.sh\n' >&2
    exit $EX_ALREADY_RUNNING
  fi
fi

# ---------------------------------------------------------------------------
# 5. Ports must be free before we launch anything
# ---------------------------------------------------------------------------
check_port() {
  local port=$1 label=$2 owner
  port_in_use "$port" || return 0
  owner=$(port_owner "$port")
  log_err "Port $port ($label) is already in use."
  if [ -n "$owner" ]; then
    printf '  Held by: %s\n' "$owner" >&2
  else
    printf '  Could not identify the owner (install lsof for details).\n' >&2
  fi
  printf '\n  Either stop that process, or pick another port:\n' >&2
  if [ "$label" = "backend" ]; then
    printf '    edit PORT= in backend/.env\n' >&2
  else
    printf '    FRONTEND_PORT=5174 bash START.sh\n' >&2
  fi
  return 1
}

PORT_BUSY=0
check_port "$PORT" backend || PORT_BUSY=1
check_port "$FRONTEND_PORT" frontend || PORT_BUSY=1
[ "$PORT_BUSY" -eq 0 ] || exit $EX_PORT_BUSY

# ---------------------------------------------------------------------------
# 6. HTTPS certificate (optional)
# ---------------------------------------------------------------------------
if [ "$HTTPS" = "1" ]; then
  if ! bash "$ROOT/scripts/generate-cert.sh"; then
    die $EX_FAIL "HTTPS=1 is set in backend/.env but the certificate could not be generated. Set HTTPS=0 to start over plain HTTP."
  fi
  SCHEME=https
else
  SCHEME=http
fi
export HTTPS

BACKEND_LOG="$ROOT/backend/logs/backend.log"
FRONTEND_LOG="$ROOT/backend/logs/frontend.log"

# ---------------------------------------------------------------------------
# 7. Launch
# ---------------------------------------------------------------------------
cleanup_on_failure() {
  for svc in backend frontend; do
    if pid=$(read_pid "$ROOT" "$svc"); then
      stop_pid "$pid" "$svc" || true
    fi
    clear_pid "$ROOT" "$svc"
  done
}

log_step "Starting backend on ${SCHEME}://${HOST}:${PORT} ..."
: > "$BACKEND_LOG"
# `exec` in the subshell means $! is the node process itself, not a wrapper
# shell — so the PID we record is the one that actually has to be killed.
( cd "$ROOT/backend" && exec node src/server.js ) >> "$BACKEND_LOG" 2>&1 < /dev/null &
BACKEND_PID=$!
disown "$BACKEND_PID" 2>/dev/null || true
write_pid "$ROOT" backend "$BACKEND_PID" "src/server.js"

# Wait for a real health response — and give up loudly instead of pretending.
health_url="${SCHEME}://127.0.0.1:${PORT}/api/health"
curl_opts=(-sf --max-time 3)
[ "$SCHEME" = "https" ] && curl_opts+=(-k)

backend_healthy=0
for _ in $(seq 1 60); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    break   # process died; report immediately rather than waiting 24s
  fi
  if command -v curl >/dev/null 2>&1; then
    if curl "${curl_opts[@]}" "$health_url" >/dev/null 2>&1; then backend_healthy=1; break; fi
  elif port_in_use "$PORT"; then
    backend_healthy=1; break
  fi
  sleep 0.4
done

if [ "$backend_healthy" -ne 1 ]; then
  log_err "Backend failed to start (no healthy response from $health_url)."
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    printf '  The process exited immediately.\n' >&2
  fi
  printf '  Full log: %s\n' "$BACKEND_LOG" >&2
  tail_log "$BACKEND_LOG" 20
  cleanup_on_failure
  exit $EX_START_FAILED
fi
log_ok "Backend healthy (PID $BACKEND_PID) — log: backend/logs/backend.log"

log_step "Starting frontend on ${SCHEME}://0.0.0.0:${FRONTEND_PORT} ..."
: > "$FRONTEND_LOG"
# Call the vite binary directly instead of `npx vite`: npx adds two wrapper
# processes, and the PID recorded by the old script pointed at the wrapper
# rather than the server, so stopping it left vite listening on 5173.
( cd "$ROOT/frontend" && exec ./node_modules/.bin/vite \
    --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort ) >> "$FRONTEND_LOG" 2>&1 < /dev/null &
FRONTEND_PID=$!
disown "$FRONTEND_PID" 2>/dev/null || true
write_pid "$ROOT" frontend "$FRONTEND_PID" vite

frontend_up=0
for _ in $(seq 1 60); do
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then break; fi
  if port_in_use "$FRONTEND_PORT"; then frontend_up=1; break; fi
  sleep 0.4
done

if [ "$frontend_up" -ne 1 ]; then
  log_err "Frontend failed to start on port $FRONTEND_PORT."
  printf '  Full log: %s\n' "$FRONTEND_LOG" >&2
  tail_log "$FRONTEND_LOG" 20
  cleanup_on_failure
  exit $EX_START_FAILED
fi
log_ok "Frontend ready (PID $FRONTEND_PID) — log: backend/logs/frontend.log"

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------
LAN_IP=$(detect_lan_ip)

banner "Inventory Management System is running"
printf '%sOpen the app:%s\n' "$C_BOLD" "$C_RESET"
printf '  %s://localhost:%s\n' "$SCHEME" "$FRONTEND_PORT"
[ -n "$LAN_IP" ] && printf '  %s://%s:%s   (other devices on this Wi-Fi)\n' "$SCHEME" "$LAN_IP" "$FRONTEND_PORT"
printf '\n%sAPI:%s\n' "$C_BOLD" "$C_RESET"
printf '  %s://localhost:%s/api\n' "$SCHEME" "$PORT"
[ -n "$LAN_IP" ] && printf '  %s://%s:%s/api\n' "$SCHEME" "$LAN_IP" "$PORT"

printf '\n%sLogs (live tail: npm run logs):%s\n' "$C_BOLD" "$C_RESET"
printf '  backend   %s\n' "$BACKEND_LOG"
printf '  frontend  %s\n' "$FRONTEND_LOG"
printf '\n%sPID files:%s .run/backend.pid, .run/frontend.pid\n' "$C_BOLD" "$C_RESET"

if [ "$HTTPS" = "1" ]; then
  printf '\n%s!%s Self-signed certificate — accept the browser warning once per device\n' "$C_YELLOW" "$C_RESET"
  printf '  (Advanced -> Proceed) to install the app. See certs/dev.crt.\n'
fi

printf '\n%sStop:%s bash STOP.sh   %s|%s   %sStatus:%s bash STOP.sh --status\n\n' \
  "$C_BOLD" "$C_RESET" "$C_DIM" "$C_RESET" "$C_BOLD" "$C_RESET"

# ---------------------------------------------------------------------------
# 8.5 Auto-open browser when services are ready
# ---------------------------------------------------------------------------
open_browser() {
  local url="$1"
  # Cross-platform: python3 webbrowser works everywhere; fall back to OS tools
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import webbrowser, sys; webbrowser.open('$url')" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  elif command -v cygstart >/dev/null 2>&1; then
    cygstart "$url" >/dev/null 2>&1 || true
  elif command -v start >/dev/null 2>&1; then
    start "$url" >/dev/null 2>&1 || true
  fi
}

# Open local frontend after everything is healthy (only when a display is available)
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ] || [ -t 1 ]; then
  open_browser "${SCHEME}://localhost:${FRONTEND_PORT}" || true
fi

# ---------------------------------------------------------------------------
# 9. Optional foreground mode
# ---------------------------------------------------------------------------
if [ "$FOREGROUND" -eq 1 ]; then
  trap 'printf "\nStopping...\n"; bash "$ROOT/STOP.sh" --quiet || true; exit 0' INT TERM
  log_info "Running in the foreground — press Ctrl-C to stop both services."
  while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
    sleep 1
  done
  log_warn "A service exited on its own; shutting the other one down."
  bash "$ROOT/STOP.sh" --quiet || true
  exit $EX_START_FAILED
fi

# ---------------------------------------------------------------------------
# 10. Keep interactive terminal open (window does not vanish immediately)
# ---------------------------------------------------------------------------
# If the user ran this from a terminal/desktop, leave the window visible so
# they can see the URLs and stop command.  Services stay running in background.
if [ -t 0 ]; then
  printf '\n%sServer running on %s://localhost:%s%s\n' "$C_BOLD" "$SCHEME" "$FRONTEND_PORT" "$C_RESET"
  printf '%sPress Enter to close this window  (services stay on)%s\n' "$C_DIM" "$C_RESET"
  printf '%sStop with: bash STOP.sh  |  Ctrl-C also stops services%s\n\n' "$C_BOLD" "$C_RESET"
  # Allow Ctrl+C to cleanly stop both services before exiting
  trap 'printf "\nStopping...\n"; bash "$ROOT/STOP.sh" --quiet || true; exit 0' INT TERM
  read -r
fi

exit $EX_OK
