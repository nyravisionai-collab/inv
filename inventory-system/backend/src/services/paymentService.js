const db = require('../db/database');
const { round2, now } = require('../utils/helpers');

/**
 * Settling a party payment against its open bills.
 *
 * A "Record Payment" entry names a customer or supplier but not an invoice.
 * Without allocation the money reduced the party's running balance while every
 * invoice stayed unpaid, so the dashboard kept reporting the amount as
 * receivable/payable. Allocations tie the two together: the payment is applied
 * to the oldest open documents first (standard FIFO settlement) and each
 * applied slice is recorded so deleting the payment can undo it exactly.
 */

const DOC = {
  payment_in: {
    table: 'sales',
    column: 'sale_id',
    dateColumn: 'invoice_date',
    openFilter: "invoice_type IN ('sale','pos') AND status = 'completed'",
  },
  payment_out: {
    table: 'purchases',
    column: 'purchase_id',
    dateColumn: 'bill_date',
    openFilter: "bill_type = 'purchase' AND status = 'completed'",
  },
};

function docConfig(paymentType) {
  return DOC[paymentType] || null;
}

/** Recompute paid/balance/status on a sale or purchase from its own row. */
function applyToDocument(cfg, docId, delta) {
  const doc = db.prepare(`SELECT grand_total, paid_amount FROM ${cfg.table} WHERE id = ?`).get(docId);
  if (!doc) return 0;

  const newPaid = Math.max(0, round2(Number(doc.paid_amount || 0) + delta));
  const newBalance = round2(Number(doc.grand_total || 0) - newPaid);
  let status = 'unpaid';
  if (newPaid >= Number(doc.grand_total || 0)) status = 'paid';
  else if (newPaid > 0) status = 'partial';

  db.prepare(
    `UPDATE ${cfg.table} SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ? WHERE id = ?`
  ).run(newPaid, Math.max(0, newBalance), status, now(), docId);

  return newPaid;
}

/** Record how much of `paymentId` was applied to a document. */
function recordAllocation(paymentId, cfg, docId, amount) {
  db.prepare(`
    INSERT INTO payment_allocations (payment_id, sale_id, purchase_id, amount)
    VALUES (?,?,?,?)
  `).run(
    paymentId,
    cfg.column === 'sale_id' ? docId : null,
    cfg.column === 'purchase_id' ? docId : null,
    round2(amount)
  );
}

/**
 * Spread a payment over the party's open documents, oldest first.
 *
 * Returns the amount that could not be applied — money received in advance of
 * any bill, which stays on the party's account as credit.
 */
function allocatePayment(payment) {
  const cfg = docConfig(payment.payment_type);
  if (!cfg) return round2(payment.amount);

  let remaining = round2(Number(payment.amount) || 0);
  if (remaining <= 0) return 0;

  // An explicitly targeted payment settles that document only, even if it
  // overpays — the user picked it deliberately.
  if (payment[cfg.column]) {
    const doc = db.prepare(`SELECT id FROM ${cfg.table} WHERE id = ?`).get(payment[cfg.column]);
    if (doc) {
      applyToDocument(cfg, doc.id, remaining);
      recordAllocation(payment.id, cfg, doc.id, remaining);
      return 0;
    }
    return remaining;
  }

  if (!payment.party_id) return remaining;

  const partyColumn = cfg.table === 'sales' ? 'customer_id' : 'supplier_id';
  const open = db.prepare(`
    SELECT id, COALESCE(balance_amount, 0) as balance
    FROM ${cfg.table}
    WHERE ${partyColumn} = ? AND ${cfg.openFilter} AND COALESCE(balance_amount, 0) > 0
    ORDER BY ${cfg.dateColumn} ASC, id ASC
  `).all(payment.party_id);

  for (const doc of open) {
    if (remaining <= 0.009) break;
    const applied = round2(Math.min(remaining, Number(doc.balance)));
    if (applied <= 0) continue;
    applyToDocument(cfg, doc.id, applied);
    recordAllocation(payment.id, cfg, doc.id, applied);
    remaining = round2(remaining - applied);
  }

  return Math.max(0, remaining);
}

/** Undo every document update made by a payment (used when it is deleted). */
function releasePayment(paymentId) {
  const rows = db.prepare('SELECT * FROM payment_allocations WHERE payment_id = ?').all(paymentId);
  for (const row of rows) {
    if (row.sale_id) applyToDocument(DOC.payment_in, row.sale_id, -Number(row.amount));
    if (row.purchase_id) applyToDocument(DOC.payment_out, row.purchase_id, -Number(row.amount));
  }
  db.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(paymentId);
  return rows.length;
}

/**
 * Detach a cancelled sale/purchase from any payment that settled it, and offer
 * that money to the party's remaining open bills.
 *
 * A cancelled document must not keep holding a customer's money hostage: the
 * payment either moves to another open invoice or returns to the account as
 * credit.
 */
function releaseDocument(kind, docId) {
  const cfg = DOC[kind];
  if (!cfg) return 0;

  const rows = db.prepare(
    `SELECT payment_id, amount FROM payment_allocations WHERE ${cfg.column} = ?`
  ).all(docId);
  if (!rows.length) return 0;

  // Take the money back off the cancelled document so it no longer reads as
  // paid, then forget the allocations.
  const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  applyToDocument(cfg, docId, -total);
  db.prepare(`DELETE FROM payment_allocations WHERE ${cfg.column} = ?`).run(docId);

  const paymentIds = [...new Set(rows.map((r) => r.payment_id))].map((id) => ({ payment_id: id }));

  for (const { payment_id: paymentId } of paymentIds) {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment) continue;
    const alreadyApplied = db.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE payment_id = ?'
    ).get(paymentId).total;
    const free = round2(Number(payment.amount) - Number(alreadyApplied));
    if (free <= 0.009) continue;
    // Re-spread the freed amount; the cancelled document no longer qualifies
    // because allocation only looks at completed bills.
    allocatePayment({ ...payment, amount: free, [cfg.column]: null });
  }

  return paymentIds.length;
}

/** Portion of a payment that is sitting on the party's account as credit. */
function unallocatedAmount(paymentId, amount) {
  const row = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE payment_id = ?'
  ).get(paymentId);
  return round2(Number(amount) - Number(row.total || 0));
}

module.exports = { allocatePayment, releasePayment, releaseDocument, unallocatedAmount, applyToDocument, docConfig };
