#!/usr/bin/env bash
# Inventory Management System — one command that does everything.
#
# For a brand new machine this is the only command you need:
#
#   bash RUN.sh
#
# It installs dependencies if they are missing, prepares the database and
# configuration on first run, then starts the app. On later runs it skips
# straight to starting, so it is safe to use every day.
#
#   bash RUN.sh --force        restart even if an instance is already running
#   bash RUN.sh --foreground   stay attached; Ctrl-C stops both services
#   bash RUN.sh --reinstall    force the full setup step again, then start
#   bash RUN.sh --help         usage
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

REINSTALL=0
START_ARGS=()
while [ $# -gt 0 ]; do
  case $1 in
    --reinstall) REINSTALL=1 ;;
    -h|--help)
      sed -n '2,16p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'
      exit $EX_OK
      ;;
    *) START_ARGS+=("$1") ;;
  esac
  shift
done

# A setup is needed when the toolchain has never been prepared here: no .env,
# no database, or missing dependency trees.
needs_setup() {
  [ "$REINSTALL" -eq 1 ] && return 0
  [ -f "$ROOT/backend/.env" ] || return 0
  [ -f "$ROOT/backend/data/inventory.db" ] || return 0
  deps_ok "$ROOT/backend" express sql.js dotenv helmet || return 0
  deps_ok "$ROOT/frontend" vite react .bin/vite || return 0
  return 1
}

if needs_setup; then
  banner "First run detected — setting everything up"
  log_info "This happens only once; it takes a few minutes."
  if [ "$REINSTALL" -eq 1 ]; then
    bash "$ROOT/scripts/install.sh" --reinstall
  else
    bash "$ROOT/scripts/install.sh"
  fi
fi

if [ ${#START_ARGS[@]} -gt 0 ]; then
  exec bash "$ROOT/START.sh" "${START_ARGS[@]}"
fi
exec bash "$ROOT/START.sh"
