#!/data/data/com.termux/files/usr/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "Stopping Inventory Management System..."

if [ -f "$ROOT/.pids" ]; then
  while read -r pid; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "  stopped PID $pid"
    fi
  done < "$ROOT/.pids" || true
  rm -f "$ROOT/.pids"
fi

pkill -f "node src/server.js" 2>/dev/null || true
pkill -f "vite --host 0.0.0.0 --port 5173" 2>/dev/null || true
pkill -f "vite.*5173" 2>/dev/null || true

echo "✓ Stopped"
