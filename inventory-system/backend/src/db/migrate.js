const fs = require('fs');
const path = require('path');
const db = require('./database');

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
