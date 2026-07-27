#!/usr/bin/env bash
# Inventory Management System — installer / first-time setup.
#
# Safe to re-run: it never overwrites an existing backend/.env and never
# deletes an existing database unless you explicitly ask for it.
#
#   bash scripts/install.sh              install dependencies + prepare config
#   bash scripts/install.sh --reinstall  also wipe node_modules and reinstall
#   bash scripts/install.sh --reset-db   DELETE the database and recreate it
#   bash scripts/install.sh --no-build   skip the production frontend build
#   bash scripts/install.sh --help       usage
#
# Exit codes: 0 ok · 1 failure · 2 missing dependency
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
source "$__dir/lib.sh"
# This script lives in scripts/, so the project root is one level up.
ROOT=$(cd -P "$__dir/.." && pwd)
cd "$ROOT"

REINSTALL=0
RESET_DB=0
DO_BUILD=1
while [ $# -gt 0 ]; do
  case $1 in
    --reinstall) REINSTALL=1 ;;
    --reset-db) RESET_DB=1 ;;
    --no-build) DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,12p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'
      exit $EX_OK
      ;;
    *) die $EX_FAIL "Unknown option '$1'. Try: bash scripts/install.sh --help" ;;
  esac
  shift
done

banner "Inventory System — Installer"
log_info "Project:  $ROOT"
log_info "Platform: $(platform_name)"

# ---------------------------------------------------------------------------
# 1. Toolchain — on Termux we can install it; elsewhere we explain how.
# ---------------------------------------------------------------------------
if is_termux && ! command -v node >/dev/null 2>&1; then
  log_step "Termux detected — installing Node.js via pkg..."
  pkg install -y nodejs || die $EX_MISSING_DEP "'pkg install nodejs' failed. Run 'pkg update' and try again."
fi
if is_termux && ! command -v curl >/dev/null 2>&1; then
  log_step "Installing curl via pkg..."
  pkg install -y curl || log_warn "Could not install curl; health checks will fall back to a port probe."
fi

check_node 18 || exit $EX_MISSING_DEP
log_ok "Node $(node --version) / npm $(npm --version)"

command -v curl >/dev/null 2>&1 || log_warn "curl is not installed — START.sh will use a plain port check instead."

# ---------------------------------------------------------------------------
# 2. Directories
# ---------------------------------------------------------------------------
log_step "Creating data directories..."
mkdir -p "$ROOT/backend/data" "$ROOT/backend/backups" "$ROOT/backend/logs" "$ROOT/.run"
for sub in logos products avatars imports misc; do
  mkdir -p "$ROOT/backend/uploads/$sub"
done
log_ok "Directories ready"

# ---------------------------------------------------------------------------
# 3. Configuration — .env.example is the single source of truth.
#    The old installer wrote its own truncated copy over the top of whatever
#    the user had, silently dropping LAN_ONLY/HTTPS/TRUST_PROXY.
# ---------------------------------------------------------------------------
ENV_FILE="$ROOT/backend/.env"
ENV_EXAMPLE="$ROOT/backend/.env.example"
[ -f "$ENV_EXAMPLE" ] || die $EX_FAIL "backend/.env.example is missing — the checkout looks incomplete."

if [ -f "$ENV_FILE" ]; then
  log_ok "Keeping your existing backend/.env"
  added=0
  while IFS= read -r line; do
    case $line in
      ''|\#*) continue ;;
    esac
    key=${line%%=*}
    if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
      printf '%s\n' "$line" >> "$ENV_FILE"
      log_info "added missing setting: $key"
      added=$((added + 1))
    fi
  done < "$ENV_EXAMPLE"
  [ "$added" -eq 0 ] && log_info "all settings already present"
else
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  log_ok "Created backend/.env from .env.example"
fi

# ---------------------------------------------------------------------------
# 4. Dependencies
# ---------------------------------------------------------------------------
if [ "$REINSTALL" -eq 1 ]; then
  log_step "--reinstall: removing existing node_modules..."
  rm -rf "$ROOT/backend/node_modules" "$ROOT/frontend/node_modules"
fi

# better-sqlite3 needs a native NDK build that Termux cannot do; sql.js is used
# instead, so drop any stale copy left behind by an older install.
rm -rf "$ROOT/backend/node_modules/better-sqlite3" 2>/dev/null || true

ensure_deps "$ROOT/backend" "backend" \
  express sql.js dotenv helmet -- --no-optional --omit=optional || exit $EX_MISSING_DEP
ensure_deps "$ROOT/frontend" "frontend" \
  vite react .bin/vite -- || exit $EX_MISSING_DEP

# ---------------------------------------------------------------------------
# 5. Database
# ---------------------------------------------------------------------------
DB_FILE="$ROOT/backend/data/inventory.db"

if [ "$RESET_DB" -eq 1 ] && [ -f "$DB_FILE" ]; then
  # Destroying real business data must never be a silent side effect.
  backup="$ROOT/backend/backups/inventory-$(date +%Y%m%d-%H%M%S).db"
  cp "$DB_FILE" "$backup"
  log_warn "--reset-db: existing database backed up to ${backup#"$ROOT"/}"
  rm -f "$DB_FILE" "$ROOT"/backend/data/*.tmp "$ROOT"/backend/data/*-wal "$ROOT"/backend/data/*-shm
  log_ok "Old database removed"
fi

if [ -f "$DB_FILE" ]; then
  log_ok "Existing database kept ($(basename "$DB_FILE")) — use --reset-db to start fresh"
else
  log_step "Creating a fresh empty database..."
  # The server's own bootstrap creates the schema and system defaults, so we
  # reuse it rather than duplicating the SQL here (which used to drift).
  ( cd "$ROOT/backend" && node -e '
      const { bootstrap } = require("./src/server.js");
      bootstrap()
        .then(({ server, db }) => {
          db.persist();
          server.close(() => process.exit(0));
        })
        .catch((e) => { console.error(e.message); process.exit(1); });
    ' >/dev/null 2>&1 ) || die $EX_FAIL "Database initialisation failed. Run it manually to see why:
    cd backend && node src/db/migrate.js"
  [ -f "$DB_FILE" ] || die $EX_FAIL "Database initialisation reported success but $DB_FILE was not created."
  log_ok "Fresh database created at backend/data/inventory.db"
fi

# ---------------------------------------------------------------------------
# 6. Frontend production build (optional; the dev server does not need it)
# ---------------------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ]; then
  log_step "Building the frontend (for SERVE_FRONTEND=1 single-port mode)..."
  if ( cd "$ROOT/frontend" && npm run build >/dev/null 2>&1 ); then
    log_ok "Frontend build complete (frontend/dist)"
  else
    # Not fatal: START.sh runs the Vite dev server, which needs no build.
    log_warn "Frontend build failed — the app still works via START.sh (dev server)."
    log_info "to see the error: cd frontend && npm run build"
  fi
else
  log_info "Skipping frontend build (--no-build)"
fi

# ---------------------------------------------------------------------------
# 7. Make the scripts executable
# ---------------------------------------------------------------------------
chmod +x "$ROOT/START.sh" "$ROOT/STOP.sh" "$ROOT/RUN.sh" \
         "$ROOT/scripts/install.sh" "$ROOT/scripts/generate-cert.sh" 2>/dev/null || true

PORT=$(env_value "$ENV_FILE" PORT); PORT=${PORT:-5000}

banner "Install complete"
printf '  %sStart the app:%s  bash START.sh      %s(or: npm start)%s\n' \
  "$C_BOLD" "$C_RESET" "$C_DIM" "$C_RESET"
printf '  %sStop the app:%s   bash STOP.sh       %s(or: npm stop)%s\n' \
  "$C_BOLD" "$C_RESET" "$C_DIM" "$C_RESET"
printf '  %sCheck status:%s   bash STOP.sh --status\n\n' "$C_BOLD" "$C_RESET"
printf '  UI   http://localhost:5173   (no login)\n'
printf '  API  http://localhost:%s/api\n\n' "$PORT"
printf '  Logs are written to backend/logs/backend.log and backend/logs/frontend.log\n\n'

exit $EX_OK
