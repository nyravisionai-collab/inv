# Inventory System

A lightweight inventory management application built with a React + Vite frontend and a Node.js + Express backend. The backend uses `sql.js`, a WebAssembly-powered SQLite engine, so the app can run with a simple local setup.

## Tech Stack

- **Frontend:** React, Vite
- **Backend:** Node.js, Express
- **Database Engine:** `sql.js` (SQLite compiled to WebAssembly)
- **Project Scripts:** `START.sh` and `STOP.sh` for simplified local operation

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

Install the following before running the project:

- Node.js
- npm
- A Unix-like shell environment for running the provided shell scripts

### Enter the Project Directory

From the repository checkout root:

```bash
cd inventory-system
```

### Start the Application

From the project directory:

```bash
./START.sh
```

If the scripts are not executable on your machine, run:

```bash
chmod +x START.sh STOP.sh
./START.sh
```

The start script is the recommended way to launch the frontend and backend together.

### Stop the Application

From the project directory:

```bash
./STOP.sh
```

Use the stop script to shut down the locally running application processes cleanly.

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
cd backend && npm audit --omit=dev   # runtime dependency vulnerabilities
```

## Security Notes

**This build has no login.** Authentication is intentionally disabled for
offline single-shop use, and the server binds to `0.0.0.0` with `CORS_ORIGIN=*`
so it can be reached from other devices on the same network. Anyone who can
reach the port can read and modify all business data.

Only run it on a network you trust. If you expose it more widely:

- put it behind a reverse proxy with its own authentication,
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
├── START.sh          # Starts the local application
├── STOP.sh           # Stops the local application
├── CODE_REVIEW.md    # Audit findings and remediation notes
└── README.md         # Consolidated project documentation
```

## Notes for Developers

- Use `START.sh` and `STOP.sh` for normal local operation.
- Keep documentation consolidated in this root `README.md` file.
- Avoid adding separate Markdown files unless the documentation strategy changes.
- Run `npm run verify` before opening changes for review.
- Wrap all user-facing text in `t('...')` and add both languages to
  `frontend/src/utils/translations.js`; `npm run i18n:check` enforces this.
- Return errors from controllers with a stable `code` so the UI can translate
  them instead of showing raw English text.
- Never commit `.env`, `*.db`, or anything under `backups/`.
