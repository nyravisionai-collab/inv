#!/usr/bin/env bash
# Generates a self-signed TLS certificate covering localhost + every LAN IP
# currently bound to this machine, so the PWA is served over HTTPS on the
# LAN too. Service workers (and therefore "Install app") only run in a
# "secure context" — https://, or http://localhost — so plain
# http://<lan-ip>:5173 on a phone can never install even though the code is
# correct. Re-run this whenever the machine's LAN IP changes.
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
# shellcheck source=scripts/lib.sh
source "$__dir/lib.sh"
ROOT=$(cd -P "$__dir/.." && pwd)
CERT_DIR="$ROOT/certs"
mkdir -p "$CERT_DIR"

CERT_FILE="$CERT_DIR/dev.crt"
KEY_FILE="$CERT_DIR/dev.key"

if ! command -v openssl >/dev/null 2>&1; then
  echo "✗ openssl not found — install it, e.g. 'pkg install openssl-tool' (Termux) or 'apt install openssl'." >&2
  exit 1
fi

collect_ips() {
  {
    if command -v ip >/dev/null 2>&1; then
      ip -4 addr show 2>/dev/null | awk '/inet / {sub(/\/.*/,"",$2); print $2}'
      ip -6 addr show 2>/dev/null | awk '/inet6 / {sub(/\/.*/,"",$2); print $2}'
    fi
    if command -v hostname >/dev/null 2>&1; then
      hostname -I 2>/dev/null | tr ' ' '\n'
    fi
    if command -v ifconfig >/dev/null 2>&1; then
      ifconfig 2>/dev/null | awk '/inet / {print $2}' | sed 's/addr://'
    fi
  } | grep -v '^$' | grep -v '^127\.' | grep -v '^::1$' | grep -v '^fe80' | sort -u
}

ALT_NAMES="DNS:localhost,IP:127.0.0.1,IP:::1"
for ip in $(collect_ips); do
  ALT_NAMES="${ALT_NAMES},IP:${ip}"
done

NEED_REGEN=1
if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
  # Reuse the existing cert if it is still valid for >7 days and already
  # covers the same SAN list (cheap heuristic: compare stored SAN list file).
  if [ -f "$CERT_DIR/dev.san" ] && [ "$(cat "$CERT_DIR/dev.san")" = "$ALT_NAMES" ] \
     && openssl x509 -checkend 604800 -noout -in "$CERT_FILE" >/dev/null 2>&1; then
    NEED_REGEN=0
  fi
fi

if [ "$NEED_REGEN" = "1" ]; then
  echo "→ Generating self-signed HTTPS certificate for: $ALT_NAMES"
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -days 825 \
    -subj "/CN=inventory-system.local" \
    -addext "subjectAltName=$ALT_NAMES" >/dev/null 2>&1
  echo "$ALT_NAMES" > "$CERT_DIR/dev.san"
  chmod 600 "$KEY_FILE"
  echo "✓ Certificate written to certs/dev.crt / certs/dev.key"
else
  echo "✓ Reusing existing certs/dev.crt (still valid, same LAN IPs)"
fi

echo ""
echo "This is a SELF-SIGNED certificate — browsers will warn 'Not secure' the"
echo "first time. On the phone/computer, open the site once and accept the"
echo "warning (Advanced -> Proceed) or install certs/dev.crt as a trusted"
echo "certificate. This is required only because there is no public domain"
echo "name for a LAN-only app; the connection itself is still encrypted."
