/**
 * Termux / Android-compatible SQLite layer.
 * Uses sql.js (pure WASM/JS — no native NDK compile) with a
 * better-sqlite3-compatible API so existing controllers stay unchanged.
 *
 * Call `await require('./database').init()` once before using the API
 * (server.js, migrate.js, seed.js, and tests all do this).
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

let SQL = null;
let rawDb = null;
let dbPath = null;
let saveTimer = null;
let closed = false;
let ready = false;
let initPromise = null;

function ensureDirs() {
  const resolved = path.resolve(config.dbPath);
  const dbDir = path.dirname(resolved);
  const roots = [
    dbDir,
    path.resolve(config.uploadDir),
    path.resolve(config.backupDir),
    path.resolve(path.join(__dirname, '../../logs')),
    path.resolve(path.join(__dirname, '../../data')),
  ];
  for (const dir of roots) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  return resolved;
}

function bindParams(stmt, params) {
  if (!params || params.length === 0) return;
  const normalized = params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
  stmt.bind(normalized);
}

function rowFromColumns(columns, values) {
  const row = {};
  for (let i = 0; i < columns.length; i++) {
    row[columns[i]] = values[i];
  }
  return row;
}

function assertReady() {
  if (!ready || !rawDb) {
    throw new Error('Database not initialized. Call await db.init() first.');
  }
}

class Statement {
  constructor(sql) {
    this.sql = sql;
  }

  get(...params) {
    assertReady();
    const stmt = rawDb.prepare(this.sql);
    try {
      bindParams(stmt, params);
      if (stmt.step()) {
        return rowFromColumns(stmt.getColumnNames(), stmt.get());
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params) {
    assertReady();
    const stmt = rawDb.prepare(this.sql);
    const rows = [];
    try {
      bindParams(stmt, params);
      const columns = stmt.getColumnNames();
      while (stmt.step()) {
        rows.push(rowFromColumns(columns, stmt.get()));
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(...params) {
    assertReady();
    const stmt = rawDb.prepare(this.sql);
    try {
      bindParams(stmt, params);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = rawDb.getRowsModified();
    let lastInsertRowid = 0;
    try {
      const r = rawDb.exec('SELECT last_insert_rowid() as id');
      if (r?.[0]?.values?.[0]) {
        lastInsertRowid = Number(r[0].values[0][0]) || 0;
      }
    } catch {
      lastInsertRowid = 0;
    }
    scheduleSave();
    return { changes, lastInsertRowid };
  }
}

function scheduleSave() {
  if (closed) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      persist();
    } catch (err) {
      console.error('DB auto-save failed:', err.message);
    }
  }, 80);
}

function persist() {
  if (!rawDb || closed || !dbPath) return;
  const data = rawDb.export();
  const buffer = Buffer.from(data);
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, dbPath);
}

function pragma(pragmaStr) {
  assertReady();
  const sql = String(pragmaStr).trim().toLowerCase().startsWith('pragma')
    ? pragmaStr
    : `PRAGMA ${pragmaStr}`;
  try {
    // Handle checkpoint specially (sql.js has no WAL file)
    if (/wal_checkpoint/i.test(sql)) {
      persist();
      return 'ok';
    }
    const result = rawDb.exec(sql);
    if (result?.[0]?.values?.[0]) return result[0].values[0][0];
  } catch (err) {
    if (process.env.DEBUG_DB) console.warn('pragma:', pragmaStr, err.message);
  }
  return null;
}

function exec(sql) {
  assertReady();
  // Support multi-statement scripts
  rawDb.run(sql);
  scheduleSave();
}

function prepare(sql) {
  assertReady();
  return new Statement(sql);
}

function transaction(fn) {
  return function runTransaction(...args) {
    assertReady();
    rawDb.run('BEGIN');
    try {
      const result = fn(...args);
      rawDb.run('COMMIT');
      scheduleSave();
      return result;
    } catch (err) {
      try {
        rawDb.run('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  };
}

function close() {
  if (closed) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    persist();
  } catch {
    /* ignore */
  }
  closed = true;
  ready = false;
  try {
    if (rawDb) rawDb.close();
  } catch {
    /* ignore */
  }
  rawDb = null;
}

/**
 * Async init — pure JS/WASM, works on Termux ARM64 without NDK.
 */
async function init() {
  if (ready && rawDb) return api;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    dbPath = ensureDirs();

    const initSqlJs = require('sql.js');
    // Resolve sql.js package root without require('sql.js/package.json') (blocked by exports)
    const sqlJsEntry = require.resolve('sql.js');
    // entry is typically .../sql.js/dist/sql-wasm.js or similar
    let sqlJsRoot = path.dirname(sqlJsEntry);
    if (path.basename(sqlJsRoot) === 'dist') {
      sqlJsRoot = path.dirname(sqlJsRoot);
    }
    // Also try walking up to find package with dist/sql-wasm.wasm
    const candidates = [
      path.join(sqlJsRoot, 'dist', 'sql-wasm.wasm'),
      path.join(path.dirname(sqlJsEntry), 'sql-wasm.wasm'),
      path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
      path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
    ];
    let wasmPath = candidates.find((p) => fs.existsSync(p));
    if (!wasmPath) {
      // Last resort: scan node_modules
      const nm = path.join(process.cwd(), 'node_modules/sql.js/dist');
      if (fs.existsSync(nm)) {
        const f = fs.readdirSync(nm).find((x) => x.endsWith('.wasm') && x.includes('sql-wasm'));
        if (f) wasmPath = path.join(nm, f);
      }
    }
    if (!wasmPath) {
      throw new Error('sql.js wasm file not found. Re-run: npm install sql.js');
    }
    const wasmDir = path.dirname(wasmPath);
    const wasmBinary = fs.readFileSync(wasmPath);

    SQL = await initSqlJs({
      wasmBinary,
      locateFile: (file) => path.join(wasmDir, file),
    });

    closed = false;
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      rawDb = new SQL.Database(new Uint8Array(fileBuffer));
    } else {
      rawDb = new SQL.Database();
      persist();
    }

    try {
      rawDb.run('PRAGMA foreign_keys = ON');
    } catch {
      /* ignore */
    }

    ready = true;
    return api;
  })();

  try {
    await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
  return api;
}

function isReady() {
  return ready && !!rawDb;
}

const api = {
  init,
  isReady,
  prepare,
  exec,
  pragma,
  transaction,
  close,
  persist,
  get raw() {
    return rawDb;
  },
  get name() {
    return dbPath;
  },
};

process.on('exit', () => {
  try {
    if (ready) close();
  } catch {
    /* ignore */
  }
});
process.on('SIGINT', () => {
  try {
    close();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
process.on('SIGTERM', () => {
  try {
    close();
  } catch {
    /* ignore */
  }
  process.exit(0);
});

module.exports = api;
