const db = require('../db/database');
const { generateNumber } = require('../utils/helpers');

const PREFIX_MAP = {
  sale: { prefix: 'invoice_prefix', next: 'invoice_next_number', defaultPrefix: 'INV' },
  estimate: { prefix: 'estimate_prefix', next: 'estimate_next_number', defaultPrefix: 'EST' },
  sale_order: { prefix: 'sale_order_prefix', next: 'sale_order_next_number', defaultPrefix: 'SO' },
  delivery_challan: { prefix: 'challan_prefix', next: 'challan_next_number', defaultPrefix: 'DC' },
  sale_return: { prefix: 'invoice_prefix', next: 'invoice_next_number', defaultPrefix: 'CN' },
  pos: { prefix: 'invoice_prefix', next: 'invoice_next_number', defaultPrefix: 'POS' },
  purchase: { prefix: 'purchase_prefix', next: 'purchase_next_number', defaultPrefix: 'PUR' },
  purchase_order: { prefix: 'purchase_prefix', next: 'purchase_next_number', defaultPrefix: 'PO' },
  purchase_return: { prefix: 'purchase_prefix', next: 'purchase_next_number', defaultPrefix: 'DN' },
  payment_in: { prefix: 'payment_in_prefix', next: 'payment_in_next_number', defaultPrefix: 'RCPT' },
  payment_out: { prefix: 'payment_out_prefix', next: 'payment_out_next_number', defaultPrefix: 'PYMT' },
};

/**
 * Reserve the next document number for `type`.
 *
 * The counter is incremented with a single atomic UPDATE and read back, rather
 * than read-then-write, so two documents can never be handed the same number.
 * Callers should run this inside their surrounding transaction.
 */
function nextNumber(type) {
  const map = PREFIX_MAP[type] || PREFIX_MAP.sale;
  const settings = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
  const prefix = (settings && settings[map.prefix]) || map.defaultPrefix;

  let next;
  if (settings) {
    // Atomic increment: the value we read back is exclusively ours.
    db.prepare(
      `UPDATE company_settings SET ${map.next} = COALESCE(${map.next}, 1) + 1 WHERE id = 1`
    ).run();
    const updated = db.prepare(`SELECT ${map.next} as n FROM company_settings WHERE id = 1`).get();
    next = Number(updated.n) - 1;
  } else {
    next = 1;
  }

  const effectivePrefix =
    type === 'sale_return' ? 'CN'
      : type === 'purchase_return' ? 'DN'
        : type === 'pos' ? 'POS'
          : type === 'purchase_order' ? 'PO'
            : prefix;

  let number = generateNumber(effectivePrefix, next);

  // Defend against collisions with numbers that already exist (for example
  // after restoring a backup taken before the counter was advanced).
  const table = type.startsWith('purchase') ? 'purchases' : type.startsWith('payment') ? 'payments' : 'sales';
  const column = table === 'purchases' ? 'bill_number' : table === 'payments' ? 'payment_number' : 'invoice_number';
  let guard = 0;
  while (guard < 1000) {
    let exists;
    try {
      exists = db.prepare(`SELECT 1 as x FROM ${table} WHERE ${column} = ?`).get(number);
    } catch {
      break;
    }
    if (!exists) break;
    next += 1;
    number = generateNumber(effectivePrefix, next);
    guard += 1;
  }
  if (guard > 0 && settings) {
    db.prepare(`UPDATE company_settings SET ${map.next} = ? WHERE id = 1`).run(next + 1);
  }

  return number;
}

function nextExpenseNumber() {
  const row = db.prepare("SELECT COUNT(*) as c FROM expenses").get();
  return generateNumber('EXP', (row.c || 0) + 1);
}

function nextIncomeNumber() {
  const row = db.prepare("SELECT COUNT(*) as c FROM incomes").get();
  return generateNumber('INC', (row.c || 0) + 1);
}

function nextJournalNumber() {
  const row = db.prepare("SELECT COUNT(*) as c FROM journal_entries").get();
  return generateNumber('JV', (row.c || 0) + 1);
}

function nextTransferNumber() {
  const row = db.prepare("SELECT COUNT(*) as c FROM stock_transfers").get();
  return generateNumber('ST', (row.c || 0) + 1);
}

function nextAdjustmentNumber() {
  const row = db.prepare("SELECT COUNT(*) as c FROM stock_adjustments").get();
  return generateNumber('SA', (row.c || 0) + 1);
}

module.exports = {
  nextNumber,
  nextExpenseNumber,
  nextIncomeNumber,
  nextJournalNumber,
  nextTransferNumber,
  nextAdjustmentNumber,
};
