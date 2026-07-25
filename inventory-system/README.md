# Inventory Management System (Termux Ready)

Production-ready Vyapar-style Inventory & Billing.

**Stack:** React + Vite · Node.js + Express · **sql.js** (pure JS SQLite) · JWT  
**Runs on:** Termux Android ARM64 · Linux · macOS · Windows  
**No native modules · No NDK · Offline capable**

## One-command start

```bash
bash scripts/install.sh   # first time only
bash START.sh
```

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:5173 · http://0.0.0.0:5173 |
| **Backend API** | http://localhost:5000 · http://0.0.0.0:5000 |

Stop: `bash STOP.sh`

### Login

| Role | Username | Password |
|------|----------|----------|
| Admin | admin | admin123 |
| Staff | staff | staff123 |
| Cashier | cashier | cashier123 |

## Termux (Android)

See **[TERMUX.md](TERMUX.md)** for full steps.

```bash
pkg update -y && pkg install -y nodejs git curl
cd inventory-system
bash scripts/install.sh
bash START.sh
# Open Chrome → http://localhost:5173
```

## Why this works on Termux

- **`better-sqlite3` removed** (needs NDK compile)
- **`sql.js`** pure WebAssembly SQLite — `npm install` only
- All other deps are pure JavaScript (`bcryptjs`, not `bcrypt`)
- Binds `0.0.0.0` for localhost + LAN
- Auto-creates `data/`, `uploads/`, `backups/`, `logs/`, `.env`

## Features (unchanged)

Dashboard · Sales (Invoice/Estimate/Order/Return/POS/PDF/WhatsApp/Barcode) · Purchases · Inventory (multi-warehouse, transfer, adjustment, batches) · Customers & Suppliers ledgers · Accounting (cash book, banks, expense, income, journal) · Reports (P&L, BS, GST, stock…) · Users & roles · Settings · Backup/Import/Export · Dark mode · Offline SW · Audit log · JWT security

## Project layout

```
inventory-system/
├── START.sh / STOP.sh / RUN.sh
├── TERMUX.md · INSTALL.md · README.md
├── backend/                 # Express API :5000
│   ├── src/db/database.js   # sql.js adapter (better-sqlite3-compatible API)
│   ├── data/ inventory.db
│   ├── uploads/ backups/ logs/
│   └── tests/
├── frontend/                # React+Vite :5173
└── scripts/install.sh
```

## Development

```bash
cd backend && npm run dev          # API watch mode
cd frontend && npm run dev         # Vite :5173
cd backend && npm test             # 35 API tests
```

## Documentation

- [INSTALL.md](INSTALL.md) — install steps
- [TERMUX.md](TERMUX.md) — Android/Termux guide
- [docs/API.md](docs/API.md) — REST API reference
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md) — verification report

## License

MIT
