# Termux Compatibility Guide

This project is fully compatible with **Termux on Android (ARM64)** and Node.js 18–24.

## What changed for Termux

| Before (not Termux-safe) | After (Termux-safe) |
|--------------------------|---------------------|
| `better-sqlite3` (native NDK) | **`sql.js`** (pure JS/WASM) |
| Port 3000 unified | Backend **5000**, Frontend **5173** |
| Native compile required | `npm install` only — no `pkg` NDK |

## Why sql.js

- No C/C++ compilation
- No Android NDK / Python build tools
- Works on ARM64, ARMv7, x86_64
- Same SQL features used by the app
- Compatible API wrapper keeps all business logic unchanged

## Termux setup (exact commands)

```bash
# 1. Packages
pkg update -y
pkg install -y nodejs git curl

# 2. Go to project
cd ~/inventory-system   # or your path

# 3. Install
bash scripts/install.sh

# 4. Start everything
bash START.sh

# 5. Open in browser (Chrome / Firefox on phone)
#    http://localhost:5173
#    or http://127.0.0.1:5173
```

### LAN access from another device

```bash
# Find phone IP
ip -4 addr | grep inet
# Open http://<phone-ip>:5173 on another device
# Ensure Termux is not battery-optimized / sleep-killed
```

### Stop

```bash
bash STOP.sh
```

## Ports

| Service | Bind | URL |
|---------|------|-----|
| Backend API | `0.0.0.0:5000` | http://localhost:5000/api |
| Frontend (Vite) | `0.0.0.0:5173` | http://localhost:5173 |

Vite proxies `/api` and `/uploads` → `http://127.0.0.1:5000`.

## Default login

- **admin** / **admin123**
- **staff** / **staff123**
- **cashier** / **cashier123**

## Offline use

1. Run `bash scripts/install.sh` once while online (downloads npm packages).
2. After that, `bash START.sh` works fully offline.
3. Frontend service worker caches UI assets.
4. SQLite data is local under `backend/data/inventory.db`.

## Folders auto-created

```
backend/data/       # SQLite file
backend/uploads/    # logos, products, imports
backend/backups/    # DB + JSON backups
backend/logs/       # backend.log, frontend.log
```

## Troubleshooting

### `EADDRINUSE`
```bash
bash STOP.sh
# or
pkill -f "node src/server"
pkill -f vite
bash START.sh
```

### Backend not healthy
```bash
cat backend/logs/backend.log
cd backend && node src/server.js   # foreground debug
```

### Reset database
```bash
bash STOP.sh
rm -f backend/data/inventory.db backend/data/*.tmp
cd backend && node src/db/migrate.js && node src/db/seed.js
bash START.sh
```

### Low memory on Termux
- Close other apps
- Prefer `bash START.sh` (Vite) over heavy multi-build
- Optional: use production single-port mode:
  ```bash
  cd frontend && npx vite build
  cd ../backend && SERVE_FRONTEND=1 PORT=5000 node src/server.js
  # then open http://localhost:5000
  ```

### sql.js wasm missing
```bash
cd backend && npm install sql.js
ls node_modules/sql.js/dist/sql-wasm.wasm
```

## Dependencies policy (Termux)

**Allowed (pure JS):** express, cors, helmet, bcryptjs, jsonwebtoken, multer, pdfkit, qrcode, xlsx, sql.js, uuid, dotenv, compression, express-rate-limit, csv-parse, csv-stringify, react, vite, axios, recharts, lucide-react, react-router-dom

**Forbidden (native):** better-sqlite3, sqlite3 (node-gyp), bcrypt (native), sharp, canvas, any `node-gyp` module

## Verification on device

```bash
curl -s http://127.0.0.1:5000/api/health
curl -s -X POST http://127.0.0.1:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5173/
```
