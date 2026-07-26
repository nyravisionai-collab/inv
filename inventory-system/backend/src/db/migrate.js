const fs = require('fs');
const path = require('path');
const db = require('./database');

/**
 * Columns added after the initial release. `CREATE TABLE IF NOT EXISTS` will
 * not alter an existing table, so each new column is applied additively.
 */
const ADDITIVE_COLUMNS = [
  ['company_settings', 'allow_negative_stock', 'INTEGER DEFAULT 0'],
  ['sale_items', 'cost_price', 'REAL DEFAULT 0'],
];

function columnExists(table, column) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

function applyAdditiveColumns() {
  for (const [table, column, definition] of ADDITIVE_COLUMNS) {
    try {
      if (!columnExists(table, column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`  + ${table}.${column}`);
      }
    } catch (err) {
      console.warn(`  ! could not add ${table}.${column}: ${err.message}`);
    }
  }
}

/** Backfill cost_price for rows written before the column existed. */
function backfillCostPrice() {
  try {
    db.exec(`
      UPDATE sale_items
      SET cost_price = COALESCE(
        (SELECT p.purchase_price FROM products p WHERE p.id = sale_items.product_id), 0)
      WHERE cost_price IS NULL OR cost_price = 0
    `);
  } catch (err) {
    console.warn(`  ! cost_price backfill skipped: ${err.message}`);
  }
}

async function migrate() {
  console.log('Running database migrations...');
  await db.init();

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  try {
    // sql.js supports multi-statement run
    db.exec('BEGIN');
    try {
      db.exec(schema);

      const existing = db.prepare('SELECT id FROM company_settings WHERE id = 1').get();
      if (!existing) {
        db.prepare(`INSERT INTO company_settings (id, company_name) VALUES (1, 'My Business')`).run();
      }

      db.exec('COMMIT');

      // Additive migrations run outside the schema transaction because
      // ALTER TABLE on an already-correct schema is a harmless no-op.
      applyAdditiveColumns();
      backfillCostPrice();
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }

    // Force persist after migration
    db.persist();
    console.log('✓ Migrations completed successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  }
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrate;
