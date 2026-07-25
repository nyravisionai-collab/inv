# Installation Guide

## Requirements

- Node.js **18+** (recommended **20** or **24** LTS)
- npm 9+
- ~200 MB free disk (after npm install)
- No Android NDK, no Python build chain required

## Quick install (any platform including Termux)

```bash
cd inventory-system
bash scripts/install.sh
bash START.sh
```

## Manual install

### 1. Backend

```bash
cd backend
cp .env.example .env   # if .env missing
npm install --no-optional --omit=optional
node src/db/migrate.js
node src/db/seed.js
```

### 2. Frontend

```bash
cd frontend
npm install
# optional production build:
npx vite build
```

### 3. Run

```bash
# From project root:
bash START.sh
```

Or manually:

```bash
# Terminal 1 — API
cd backend && PORT=5000 HOST=0.0.0.0 node src/server.js

# Terminal 2 — UI
cd frontend && npx vite --host 0.0.0.0 --port 5173
```

## URLs

- UI: http://localhost:5173
- API: http://localhost:5000/api
- Health: http://localhost:5000/api/health

## Login

| User | Password |
|------|----------|
| admin | admin123 |
| staff | staff123 |
| cashier | cashier123 |

## Tests

```bash
cd backend
npm test
npm run lint
```

## Uninstall / clean

```bash
bash STOP.sh
rm -rf backend/node_modules frontend/node_modules
rm -rf backend/data/*.db backend/data/*.tmp
```

## Upgrade from better-sqlite3 builds

Old `inventory.db` files created by `better-sqlite3` are standard SQLite and **usually** open in sql.js. If migrate fails:

```bash
mv backend/data/inventory.db backend/data/inventory.db.bak
cd backend && node src/db/migrate.js && node src/db/seed.js
```

Restore data from Settings → Backup JSON if needed.
