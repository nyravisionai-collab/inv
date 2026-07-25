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

## Backend Tests

Run backend tests from the project directory:

```bash
cd backend
npm test
```

## Project Layout

```text
inventory-system/
├── backend/      # Node.js + Express API and sql.js database logic
├── frontend/     # React + Vite user interface
├── START.sh      # Starts the local application
├── STOP.sh       # Stops the local application
└── README.md     # Consolidated project documentation
```

## Notes for Developers

- Use `START.sh` and `STOP.sh` for normal local operation.
- Keep documentation consolidated in this root `README.md` file.
- Avoid adding separate Markdown files unless the documentation strategy changes.
- Run backend tests before opening changes for review.
