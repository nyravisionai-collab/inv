# Inventory System

A lightweight inventory management application built with a React + Vite frontend and a Node.js + Express backend. The backend uses `sql.js`, a WebAssembly-powered SQLite engine, so the app can run with a simple local setup.

## Tech Stack

- **Frontend:** React, Vite
- **Backend:** Node.js, Express
- **Database Engine:** `sql.js` (SQLite compiled to WebAssembly)
- **Project Scripts:** `RUN.sh` (one-command setup + start), `START.sh`, `STOP.sh`

## Key Features

- Inventory management workflow for day-to-day stock tracking
- Browser-based React interface
- Express API backend
- Local SQLite-style storage powered by `sql.js`
- Gujarati / English language toggle for bilingual use

## Gujarati / English Language Toggle

The application includes a bilingual UI toggle so users can switch between English and Gujarati. This makes the inventory workflow easier for teams that prefer either language.

The language toggle is designed to support:

- English labels and interface text
- Gujarati labels and interface text
- Quick switching from the application UI
- A cleaner user experience for multilingual inventory teams

## Getting Started

### Prerequisites

- **Node.js 18 or newer** and npm
- bash (Termux, Linux, macOS, or WSL)

`curl` and `lsof` are optional — the scripts fall back to built-in checks when
they are missing, which matters on a bare Termux install.

### First run — one command

From the repository checkout:

```bash
cd inventory-system
bash RUN.sh
```

`RUN.sh` is the only command a new machine needs. It checks your Node version,
installs backend and frontend dependencies, creates `backend/.env` and an empty
database, then starts the app. On Termux it installs Node via `pkg` if it is
missing.

Every later run skips straight to starting, so `bash RUN.sh` is also fine as
your day-to-day command.

The scripts work from **any** working directory (and through a symlink), so
this is equally valid:

```bash
bash ~/projects/inv/inventory-system/RUN.sh
```

### Daily use

| Command | What it does |
| --- | --- |
| `npm start` / `bash START.sh` | Start backend + frontend |
| `npm stop` / `bash STOP.sh` | Stop both, and confirm the ports are free |
| `npm run restart` / `bash START.sh --force` | Restart a running instance |
| `npm run status` / `bash STOP.sh --status` | Show what is running and which ports are held |
| `npm run logs` | Live-tail both log files |
| `npm run setup` | Re-run the installer (safe; keeps your data) |

Add `--foreground` to `START.sh` to keep it attached to your terminal, where
Ctrl-C stops both services — handy over SSH or in a Termux session.

### Where the logs go

Both services write to `backend/logs/`, and START.sh prints these paths every
time it runs:

```text
backend/logs/backend.log     API server output
backend/logs/frontend.log    Vite dev server output
```

Follow them live with `npm run logs`. Each start truncates the file, so what
you see always belongs to the current run. Process IDs live in `.run/`
(`.run/backend.pid`, `.run/frontend.pid`); both directories are git-ignored.

### Changing the ports

The backend port comes from `PORT` in `backend/.env`; the scripts respect
whatever you set there and no longer overwrite it. The frontend port is 5173 by
default and can be overridden per run:

```bash
FRONTEND_PORT=5174 bash START.sh
```

If a port is already taken, START.sh refuses to start, names the process
holding it, and exits with code 3 rather than leaving you with a half-started
app.

### Exit codes

Useful when calling the scripts from another script or a service manager:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Generic failure (e.g. an unknown option) |
| 2 | Missing dependency — Node/npm not installed or too old |
| 3 | A required port is already in use |
| 4 | The app is already running (use `--force` to restart) |
| 5 | A service was launched but never became healthy |
| 6 | A process could not be stopped |

### Installer options

```bash
bash scripts/install.sh              # install dependencies, keep existing data
bash scripts/install.sh --reinstall  # wipe node_modules and reinstall
bash scripts/install.sh --reset-db   # DELETE the database (backs it up first)
bash scripts/install.sh --no-build   # skip the production frontend build
```

The installer is safe to re-run: it never overwrites an existing
`backend/.env` (it only appends settings that are missing, such as a
`LAN_ONLY` key added by a later release) and never deletes your database
unless you pass `--reset-db`, which takes a timestamped backup into
`backend/backups/` first.

### Troubleshooting

| Symptom | What to do |
| --- | --- |
| `Port 5000 is already in use` | Stop the named process, or change `PORT` in `backend/.env` |
| `already running` (exit 4) | `bash START.sh --force`, or `bash STOP.sh` first |
| `Backend failed to start` | The last 20 log lines are printed; full log in `backend/logs/backend.log` |
| `Node.js >= 18 is required` | Termux: `pkg install nodejs` · Debian/Ubuntu: `sudo apt install nodejs npm` · macOS: `brew install node` |
| `dependencies look incomplete` | An interrupted `npm install`; the scripts re-install automatically |
| Stale PID file | Cleaned up automatically; a recycled PID is never signalled |

## Quality Checks

Run everything the CI pipeline runs:

```bash
npm run verify      # lint + tests + translation coverage + build
```

Or individually:

```bash
npm run lint                    # ESLint across backend and frontend
npm test                        # 54 backend unit + API tests
npm run i18n:check              # reports untranslated / missing UI strings
npm run build                   # production frontend build
npm run lint:sh                 # shellcheck across all shell scripts
npm run test:sh                 # start/stop regression tests (uses real ports)
cd backend && npm audit --omit=dev   # runtime dependency vulnerabilities
```

## Very old phones (Windows Phone) — Lite client

The React app needs a modern browser. For devices whose browser is too old —
a Windows Phone with only Internet Explorer/old Edge left working, ancient
Android stock browsers, etc. — the backend serves **Inventory Lite**, an ES5
client that runs on practically anything:

```
http://<LAN-IP>:5000/lite        (always, served by the backend)
http://<LAN-IP>:5173/lite        (when the frontend dev/preview server runs)
```

`START.sh` prints the exact URL when the server starts. Old browsers that
open the normal app URL are forwarded to `/lite/` automatically via a
`<script nomodule>` redirect in `frontend/index.html` — no bookmark juggling
needed.

**Lite is feature-complete**: it talks to the same API and the same live data
as the desktop app, and every screen in the React sidebar has a Lite
equivalent. Five thumb-sized tabs (Home / Sale / Stock / Bills / More) with
everything else behind **More**:

| Area | What Lite can do |
| --- | --- |
| Dashboard | All KPIs (sales, cash, profit, stock value, receivables, payables, bank), low-stock list, top products, recent transactions, quick actions |
| POS | Item search and barcode scan-to-add, per-line qty/price/discount, customer, bill discount in ₹ or %, all payment modes, full/part/credit payment |
| Sales | Invoices, estimates, sale orders, delivery challans, sale returns — create, list, search, view, cancel, convert, invoice PDF, WhatsApp share |
| Purchases | Purchase bills, orders and returns, with batch/expiry per line and new items created straight from a bill |
| Parties | Customers and suppliers: create, edit, delete, ledger with date range, outstanding list, ledger PDF, WhatsApp payment reminder |
| Payments | Payment in/out with mode, bank account and auto-settlement against the oldest open bills; delete a payment |
| Inventory | Products (full CRUD incl. HSN, MRP, tax mode, barcode), stock adjustments, stock transfers, low stock, stock report, categories, brands, units, warehouses, printable QR barcode sheet |
| Accounting | Expenses, income, cash & bank accounts, cash book with date range + PDF, balanced journal entries |
| Reports | All 14 reports (P&L, balance sheet, GST with rate/HSN breakdown, sales, purchases, expenses, stock, warehouse stock, expiry, customers, suppliers, outstanding, product profit, customer profit) with date ranges and server-side PDF export |
| System | Company settings, tax rates, users, activity log, backup / restore, CSV export |
| Everywhere | Gujarati ⇄ English toggle, global search, notification badge, hardware Back-button support |

Money math (line totals, tax modes, proportional bill discount) is mirrored
from `backend/src/utils/helpers.js`, so the total the phone shows matches the
server to the paisa — required because a cash bill posts
`paid_amount = grandTotal`.

### Working on the lite client

```
backend/public/lite/
  index.html            app shell + script tags (load order matters)
  css/lite.css          floats only — no flexbox/grid
  js/i18n.js            Gujarati + English strings
  js/core.js            state, XHR helper, money math, shared renderers
  js/app.js             router, tab bar, "More" menu
  js/screens/*.js       one file per feature area
  fonts/                bundled Noto Sans Gujarati (old handsets lack Indic fonts)
```

Keep it **strictly ES5**: no `let`/`const`, arrow functions, template
literals, modules, `fetch`, `Promise`, `classList`, `Object.assign`,
`Array.from` or `String.prototype.includes`. `tests/lite.test.js` enforces
this — it parses every file with `ecmaVersion: 5`, greps for banned runtime
APIs, and fails if a menu entry has no registered screen. Adding a screen is
`Lite.screens.myScreen = { title: fn, render: fn }` plus an entry in the
`MENU` table in `app.js`. There is nothing to install or build on the phone:
it is a plain web page, not an app store app.

## Security Notes

**This build has no login.** Authentication is intentionally disabled for
offline single-shop use. The app binds to `0.0.0.0` so phones/tablets/computers
on the same network can open it, but `LAN_ONLY=1` is enabled by default so the
frontend and backend reject clients whose source IP is not local/private LAN
(loopback, `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, link-local, common local
VPN/mesh `100.64-127.x.x`, and IPv6 ULA/link-local).

Anyone on your trusted LAN who can reach the port can read and modify all
business data. Keep router port-forwarding disabled and do not expose ports
`5000` or `5173` to the internet.

Only run it on a network you trust. If you intentionally expose it more widely:

- put it behind a reverse proxy with its own authentication,
- set `LAN_ONLY=0` only after the proxy/firewall handles access control,
- set `TRUST_PROXY=1` so rate limiting sees real client IPs,
- restrict `CORS_ORIGIN` to your actual frontend origin.

Runtime files (`backend/.env`, `backend/data/`, `backend/backups/`) hold real
business data and are deliberately excluded from version control.

### Negative stock

Sales are rejected when they would take stock below zero. To allow overselling,
enable it explicitly:

```sql
UPDATE company_settings SET allow_negative_stock = 1 WHERE id = 1;
```

## Backend Tests

Run backend tests from the project directory:

```bash
cd backend
npm test
```

Tests cover the money maths (including tax-inclusive pricing), input
validation, LIKE-escaping, audit-log redaction, the XLSX round-trip, and API
regression cases such as oversell prevention and atomic document conversion.

## Project Layout

```text
inventory-system/
├── backend/          # Node.js + Express API and sql.js database logic
│   ├── src/utils/    # validation, sanitisation, PDF and XLSX helpers
│   └── tests/        # unit + API tests
├── frontend/         # React + Vite user interface
│   ├── src/context/  # auth/settings, toasts, confirm dialogs
│   └── scripts/      # i18n coverage checker
├── RUN.sh            # One command: set up (first run) then start
├── START.sh          # Starts the local application
├── STOP.sh           # Stops it and confirms the ports are free
├── scripts/
│   ├── install.sh    # Idempotent installer / first-time setup
│   ├── lib.sh        # Shared shell helpers (ports, PID files, logging)
│   ├── generate-cert.sh   # Self-signed LAN certificate for HTTPS/PWA
│   └── test-scripts.sh    # Regression tests for the shell scripts
├── CODE_REVIEW.md    # Audit findings and remediation notes
└── README.md         # Consolidated project documentation
```

## Notes for Developers

- Use `RUN.sh` for a first run, then `START.sh` / `STOP.sh` day to day.
- Shell scripts must pass `npm run lint:sh` (shellcheck) and `npm run test:sh`.
- Put shared shell logic in `scripts/lib.sh` rather than duplicating it, and
  use `set -euo pipefail` plus the documented exit codes in every script.
- Keep documentation consolidated in this root `README.md` file.
- Avoid adding separate Markdown files unless the documentation strategy changes.
- Run `npm run verify` before opening changes for review.
- Wrap all user-facing text in `t('...')` and add both languages to
  `frontend/src/utils/translations.js`; `npm run i18n:check` enforces this.
- Return errors from controllers with a stable `code` so the UI can translate
  them instead of showing raw English text.
- Never commit `.env`, `*.db`, or anything under `backups/`.
