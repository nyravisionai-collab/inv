#!/data/data/com.termux/files/usr/bin/bash
# Inventory Management System — Termux / Linux start (no login, LAN ready)
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

mkdir -p backend/data backend/uploads backend/backups backend/logs
mkdir -p backend/uploads/logos backend/uploads/products backend/uploads/avatars backend/uploads/imports backend/uploads/misc

if [ ! -f backend/.env ]; then
  cat > backend/.env << 'EOF'
PORT=5000
HOST=0.0.0.0
DB_PATH=./data/inventory.db
UPLOAD_DIR=./uploads
BACKUP_DIR=./backups
NODE_ENV=production
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=2000
CORS_ORIGIN=*
COMPANY_NAME=My Business
CURRENCY=INR
CURRENCY_SYMBOL=₹
TIMEZONE=Asia/Kolkata
EOF
fi

# Ensure HOST/PORT for LAN
if ! grep -q '^HOST=' backend/.env 2>/dev/null; then echo 'HOST=0.0.0.0' >> backend/.env; fi
if ! grep -q '^PORT=' backend/.env 2>/dev/null; then echo 'PORT=5000' >> backend/.env; fi
sed -i 's/^HOST=.*/HOST=0.0.0.0/' backend/.env 2>/dev/null || true
sed -i 's/^PORT=.*/PORT=5000/' backend/.env 2>/dev/null || true

if [ ! -d backend/node_modules/sql.js ] && [ ! -d backend/node_modules/express ]; then
  echo "→ Installing backend dependencies..."
  (cd backend && npm install --no-optional --omit=optional)
fi
if [ ! -d frontend/node_modules/vite ]; then
  echo "→ Installing frontend dependencies..."
  (cd frontend && npm install)
fi

# Stop previous
if [ -f "$ROOT/.pids" ]; then
  while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$ROOT/.pids" || true
  rm -f "$ROOT/.pids"
fi
pkill -f "node src/server.js" 2>/dev/null || true
pkill -f "vite --host 0.0.0.0 --port 5173" 2>/dev/null || true
pkill -f "vite.*5173" 2>/dev/null || true
sleep 1

detect_ip() {
  IP=""
  if command -v ip >/dev/null 2>&1; then
    IP=$(ip -4 addr show 2>/dev/null | awk '/inet / && $2 !~ /^127/ && $2 !~ /^169\.254/ {sub(/\/.*/,"",$2); print $2; exit}')
  fi
  if [ -z "$IP" ] && command -v hostname >/dev/null 2>&1; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [ -z "$IP" ] && command -v ifconfig >/dev/null 2>&1; then
    IP=$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}' | sed 's/addr://')
  fi
  echo "$IP"
}

LAN_IP=$(detect_ip)

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Inventory Management System                            ║"
echo "║   Offline desktop mode — No Login                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

cd "$ROOT/backend"
export PORT=5000
export HOST=0.0.0.0
export NODE_ENV=production
nohup node src/server.js > "$ROOT/backend/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$ROOT/.pids"
echo "✓ Backend PID $BACKEND_PID"

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:5000/api/health >/dev/null 2>&1; then
    echo "✓ Backend healthy"
    break
  fi
  sleep 0.4
done

cd "$ROOT/frontend"
nohup npx vite --host 0.0.0.0 --port 5173 --strictPort > "$ROOT/backend/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$ROOT/.pids"
echo "✓ Frontend PID $FRONTEND_PID"

sleep 2

echo ""
echo "Frontend:"
echo "  http://localhost:5173"
echo "  http://127.0.0.1:5173"
if [ -n "$LAN_IP" ]; then
  echo "  http://${LAN_IP}:5173"
fi
echo ""
echo "Backend:"
echo "  http://localhost:5000"
echo "  http://127.0.0.1:5000"
if [ -n "$LAN_IP" ]; then
  echo "  http://${LAN_IP}:5000"
fi
echo ""
echo "Dashboard opens directly (no login)."
echo "Logs: backend/logs/backend.log  backend/logs/frontend.log"
echo "Stop: bash STOP.sh"
echo ""
