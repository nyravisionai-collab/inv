const fs = require('fs');
const path = require('path');
const db = require('./database');

/**
 * Columns added after the initial release. `CREATE TABLE IF NOT EXISTS` will
 * not alter an existing table, so each new column is applied additively.
 */
const ADDITIVE_COLUMNS = [
  ['company_settings', 'allow_negative_stock', 'INTEGER DEFAULT 0'],
  ['sales', 'transporter_name', 'TEXT'],
  ['sales', 'vehicle_number', 'TEXT'],
  ['sales', 'lr_number', 'TEXT'],
  ['sales', 'dispatch_address', 'TEXT'],
  ['sales', 'eway_bill_number', 'TEXT'],
  ['sale_items', 'cost_price', 'REAL DEFAULT 0'],
  ['sale_items', 'invoice_discount_amount', 'REAL DEFAULT 0'],
  ['sale_items', 'tax_type', "TEXT DEFAULT 'exclusive'"],
  ['sale_items', 'taxable_amount', 'REAL DEFAULT 0'],
  ['purchase_items', 'invoice_discount_amount', 'REAL DEFAULT 0'],
  ['purchase_items', 'tax_type', "TEXT DEFAULT 'exclusive'"],
  ['purchase_items', 'taxable_amount', 'REAL DEFAULT 0'],
  ['purchase_items', 'prev_purchase_price', 'REAL'],
  ['purchase_items', 'prev_selling_price', 'REAL'],
  ['purchase_items', 'prev_mrp', 'REAL'],
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

/**
 * Seed warehouse_stock for products that only ever had a product-level total.
 *
 * Stock validation works per warehouse, so a product carrying `current_stock`
 * with no `warehouse_stock` row would otherwise look out of stock and block
 * every sale on an upgraded database.
 */
function backfillWarehouseStock() {
  try {
    const warehouse = db.prepare(
      'SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1'
    ).get() || db.prepare('SELECT id FROM warehouses WHERE is_active = 1 LIMIT 1').get();
    if (!warehouse) return;

    const orphans = db.prepare(`
      SELECT id, COALESCE(current_stock, 0) as qty
      FROM products
      WHERE COALESCE(is_service, 0) = 0
        AND COALESCE(current_stock, 0) <> 0
        AND id NOT IN (SELECT DISTINCT product_id FROM warehouse_stock)
    `).all();

    if (!orphans.length) return;

    const insert = db.prepare(
      'INSERT INTO warehouse_stock (product_id, warehouse_id, quantity) VALUES (?, ?, ?)'
    );
    for (const p of orphans) insert.run(p.id, warehouse.id, p.qty);
    console.log(`  + seeded warehouse stock for ${orphans.length} product(s)`);
  } catch (err) {
    console.warn(`  ! warehouse stock backfill skipped: ${err.message}`);
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

/** Backfill persisted tax mode/taxable values for line items. */
function backfillLineTaxColumns() {
  try {
    if (columnExists('sale_items', 'taxable_amount')) {
      db.exec(`
        UPDATE sale_items
        SET tax_type = COALESCE(
              NULLIF(tax_type, ''),
              (SELECT p.tax_type FROM products p WHERE p.id = sale_items.product_id),
              'exclusive'
            ),
            taxable_amount = ROUND(COALESCE(total, 0) - COALESCE(tax_amount, 0), 2),
            invoice_discount_amount = COALESCE(invoice_discount_amount, 0)
        WHERE taxable_amount IS NULL OR taxable_amount = 0 OR tax_type IS NULL
      `);
    }
    if (columnExists('purchase_items', 'taxable_amount')) {
      db.exec(`
        UPDATE purchase_items
        SET tax_type = COALESCE(
              NULLIF(tax_type, ''),
              (SELECT p.tax_type FROM products p WHERE p.id = purchase_items.product_id),
              'exclusive'
            ),
            taxable_amount = ROUND(COALESCE(total, 0) - COALESCE(tax_amount, 0), 2),
            invoice_discount_amount = COALESCE(invoice_discount_amount, 0)
        WHERE taxable_amount IS NULL OR taxable_amount = 0 OR tax_type IS NULL
      `);
    }
  } catch (err) {
    console.warn(`  ! line tax backfill skipped: ${err.message}`);
  }
}

/** Fix historical return payments that were stored with the normal bill direction. */
function backfillReturnPaymentDirections() {
  try {
    db.exec(`
      UPDATE payments
      SET payment_type = 'payment_out'
      WHERE payment_type = 'payment_in'
        AND sale_id IN (SELECT id FROM sales WHERE invoice_type = 'sale_return')
    `);
    db.exec(`
      UPDATE payments
      SET payment_type = 'payment_in'
      WHERE payment_type = 'payment_out'
        AND purchase_id IN (SELECT id FROM purchases WHERE bill_type = 'purchase_return')
    `);
  } catch (err) {
    console.warn(`  ! return payment direction backfill skipped: ${err.message}`);
  }
}

/** Assign old NULL cash payments to the cash account so deletes/cash-book can reverse them. */
function backfillPaymentBankAccounts() {
  try {
    const cash = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get()
      || db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' LIMIT 1").get();
    if (!cash) return;
    db.prepare(`
      UPDATE payments
      SET bank_account_id = ?
      WHERE bank_account_id IS NULL AND COALESCE(payment_mode, 'cash') IN ('cash','upi','card','other')
    `).run(cash.id);
  } catch (err) {
    console.warn(`  ! payment bank backfill skipped: ${err.message}`);
  }
}

/** Recompute bank balances from the transaction tables after direction/account fixes. */
function recomputeBankBalances() {
  try {
    const accounts = db.prepare('SELECT id, COALESCE(opening_balance, 0) as opening FROM bank_accounts').all();
    for (const acc of accounts) {
      const payments = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN payment_type = 'payment_in' THEN amount ELSE 0 END), 0) as debit,
          COALESCE(SUM(CASE WHEN payment_type = 'payment_out' THEN amount ELSE 0 END), 0) as credit
        FROM payments WHERE bank_account_id = ?
      `).get(acc.id);
      const expenses = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE bank_account_id = ?').get(acc.id);
      const incomes = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM incomes WHERE bank_account_id = ?').get(acc.id);
      const journals = db.prepare(`
        SELECT COALESCE(SUM(debit), 0) as debit, COALESCE(SUM(credit), 0) as credit
        FROM journal_entry_lines WHERE bank_account_id = ?
      `).get(acc.id);
      const balance = Number(acc.opening)
        + Number(payments.debit) - Number(payments.credit)
        + Number(incomes.total) - Number(expenses.total)
        - Number(journals.debit) + Number(journals.credit);
      db.prepare("UPDATE bank_accounts SET current_balance = ROUND(?, 2), updated_at = datetime('now','localtime') WHERE id = ?")
        .run(balance, acc.id);
    }
  } catch (err) {
    console.warn(`  ! bank balance recompute skipped: ${err.message}`);
  }
}

/** Refresh party balances unconditionally so opening-balance signs and returns are consistent. */
function recomputePartyBalances() {
  try {
    const partyService = require('../services/partyService');
    for (const c of db.prepare('SELECT id FROM customers').all()) partyService.updateCustomerBalance(c.id);
    for (const s of db.prepare('SELECT id FROM suppliers').all()) partyService.updateSupplierBalance(s.id);
  } catch (err) {
    console.warn(`  ! party balance recompute skipped: ${err.message}`);
  }
}

/**
 * Rebuild payment allocations for databases written before the table existed.
 *
 * Old rows fall into two groups: payments tied to a document (their amount is
 * already inside that document's paid_amount, so the allocation just records
 * the fact), and loose party payments (never settled against anything, which
 * is exactly the bug — those are spread over the open bills now).
 */
function backfillPaymentAllocations() {
  try {
    const done = db.prepare('SELECT COUNT(*) as c FROM payment_allocations').get().c;
    if (done > 0) return;

    const paymentService = require('../services/paymentService');

    const linked = db.prepare(
      'SELECT * FROM payments WHERE sale_id IS NOT NULL OR purchase_id IS NOT NULL'
    ).all();
    const insert = db.prepare(
      'INSERT INTO payment_allocations (payment_id, sale_id, purchase_id, amount) VALUES (?,?,?,?)'
    );
    for (const p of linked) {
      insert.run(p.id, p.sale_id || null, p.purchase_id || null, p.amount);
    }

    const loose = db.prepare(`
      SELECT * FROM payments
      WHERE sale_id IS NULL AND purchase_id IS NULL AND party_id IS NOT NULL
      ORDER BY payment_date ASC, id ASC
    `).all();
    for (const p of loose) {
      paymentService.allocatePayment(p);
    }

    if (linked.length || loose.length) {
      console.log(`  + allocated ${linked.length + loose.length} existing payment(s)`);
    }

    // Party balances are derived from allocations, so refresh them.
    const partyService = require('../services/partyService');
    for (const c of db.prepare('SELECT id FROM customers').all()) {
      partyService.updateCustomerBalance(c.id);
    }
    for (const s of db.prepare('SELECT id FROM suppliers').all()) {
      partyService.updateSupplierBalance(s.id);
    }
  } catch (err) {
    console.warn(`  ! payment allocation backfill skipped: ${err.message}`);
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
        db.prepare(`INSERT INTO company_settings (id, company_name) VALUES (1, 'Electricalskart')`).run();
      }

      db.exec('COMMIT');

      // Additive migrations run outside the schema transaction because
      // ALTER TABLE on an already-correct schema is a harmless no-op.
      applyAdditiveColumns();
      backfillCostPrice();
      backfillLineTaxColumns();
      backfillWarehouseStock();
      backfillReturnPaymentDirections();
      backfillPaymentAllocations();
      backfillPaymentBankAccounts();
      recomputeBankBalances();
      recomputePartyBalances();
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
