const db = require('../db/database');
const { round2, now } = require('../utils/helpers');

/**
 * Settling a party payment against its open bills.
 *
 * A "Record Payment" entry names a customer or supplier but not an invoice.
 * Allocations tie that money to the oldest matching open documents first, and
 * let deletion/cancellation reverse each settled slice exactly.
 */

const DOC = {
  payment_in_customer: {
    table: 'sales',
    column: 'sale_id',
    partyColumn: 'party_id',
    dateColumn: 'invoice_date',
    openFilter: "invoice_type IN ('sale','pos') AND status = 'completed'",
  },
  payment_out_customer: {
    table: 'sales',
    column: 'sale_id',
    partyColumn: 'party_id',
    dateColumn: 'invoice_date',
    openFilter: "invoice_type = 'sale_return' AND status = 'completed'",
  },
  payment_out_supplier: {
    table: 'purchases',
    column: 'purchase_id',
    partyColumn: 'party_id',
    dateColumn: 'bill_date',
    openFilter: "bill_type = 'purchase' AND status = 'completed'",
  },
  payment_in_supplier: {
    table: 'purchases',
    column: 'purchase_id',
    partyColumn: 'party_id',
    dateColumn: 'bill_date',
    openFilter: "bill_type = 'purchase_return' AND status = 'completed'",
  },
};

// Legacy aliases used by releaseDocument callers and old migrations.
DOC.payment_in = DOC.payment_in_customer;
DOC.payment_out = DOC.payment_out_supplier;

function docConfig(paymentType, partyType = null) {
  if (partyType) return DOC[`${paymentType}_${partyType}`] || null;
  return DOC[paymentType] || null;
}

function configForDocument(table, docId) {
  if (table === 'sales') {
    const sale = db.prepare('SELECT invoice_type FROM sales WHERE id = ?').get(docId);
    return sale?.invoice_type === 'sale_return' ? DOC.payment_out_customer : DOC.payment_in_customer;
  }
  const purchase = db.prepare('SELECT bill_type FROM purchases WHERE id = ?').get(docId);
  return purchase?.bill_type === 'purchase_return' ? DOC.payment_in_supplier : DOC.payment_out_supplier;
}

/**
 * Recompute paid/balance/status on a sale or purchase.
 * Returns the actual delta applied, capped to the document's open/paid amount,
 * so targeted overpayments become unapplied credit instead of disappearing.
 */
function applyToDocument(cfg, docId, delta) {
  const doc = db.prepare(`SELECT grand_total, paid_amount FROM ${cfg.table} WHERE id = ?`).get(docId);
  if (!doc) return 0;

  const grand = round2(Number(doc.grand_total || 0));
  const paid = round2(Number(doc.paid_amount || 0));
  let applied;
  if (delta >= 0) applied = round2(Math.min(Number(delta), Math.max(0, grand - paid)));
  else applied = -round2(Math.min(Math.abs(Number(delta)), paid));

  const newPaid = round2(Math.max(0, Math.min(grand, paid + applied)));
  const newBalance = round2(Math.max(0, grand - newPaid));
  let status = 'unpaid';
  if (newPaid >= grand - 0.009) status = 'paid';
  else if (newPaid > 0) status = 'partial';

  db.prepare(
    `UPDATE ${cfg.table} SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ? WHERE id = ?`
  ).run(newPaid, newBalance, status, now(), docId);

  return applied;
}

/** Record how much of `paymentId` was applied to a document. */
function recordAllocation(paymentId, cfg, docId, amount) {
  const applied = round2(amount);
  if (applied <= 0) return;
  db.prepare(`
    INSERT INTO payment_allocations (payment_id, sale_id, purchase_id, amount)
    VALUES (?,?,?,?)
  `).run(
    paymentId,
    cfg.column === 'sale_id' ? docId : null,
    cfg.column === 'purchase_id' ? docId : null,
    applied
  );
}

/** Spread a payment over the party's open documents, oldest first. */
function allocatePayment(payment) {
  const cfg = docConfig(payment.payment_type, payment.party_type);
  if (!cfg) return round2(payment.amount);

  let remaining = round2(Number(payment.amount) || 0);
  if (remaining <= 0) return 0;

  // An explicitly targeted payment settles that document first. Any overpaid
  // remainder stays unallocated on the party account.
  if (payment[cfg.column]) {
    const doc = db.prepare(`SELECT id FROM ${cfg.table} WHERE id = ?`).get(payment[cfg.column]);
    if (doc) {
      const applied = applyToDocument(cfg, doc.id, remaining);
      recordAllocation(payment.id, cfg, doc.id, applied);
      return Math.max(0, round2(remaining - applied));
    }
    return remaining;
  }

  if (!payment.party_id) return remaining;

  const open = db.prepare(`
    SELECT id, COALESCE(balance_amount, 0) as balance
    FROM ${cfg.table}
    WHERE ${cfg.partyColumn} = ? AND ${cfg.openFilter} AND COALESCE(balance_amount, 0) > 0
    ORDER BY ${cfg.dateColumn} ASC, id ASC
  `).all(payment.party_id);

  for (const doc of open) {
    if (remaining <= 0.009) break;
    const applied = applyToDocument(cfg, doc.id, remaining);
    if (applied <= 0) continue;
    recordAllocation(payment.id, cfg, doc.id, applied);
    remaining = round2(remaining - applied);
  }

  return Math.max(0, remaining);
}

/** Undo every document update made by a payment (used when it is deleted). */
function releasePayment(paymentId) {
  const rows = db.prepare('SELECT * FROM payment_allocations WHERE payment_id = ?').all(paymentId);
  for (const row of rows) {
    if (row.sale_id) applyToDocument(configForDocument('sales', row.sale_id), row.sale_id, -Number(row.amount));
    if (row.purchase_id) applyToDocument(configForDocument('purchases', row.purchase_id), row.purchase_id, -Number(row.amount));
  }
  db.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(paymentId);
  return rows.length;
}

/** Detach a cancelled sale/purchase from any payment that settled it. */
function releaseDocument(kind, docId) {
  let cfg = DOC[kind];
  if (cfg?.table === 'sales') cfg = configForDocument('sales', docId);
  if (cfg?.table === 'purchases') cfg = configForDocument('purchases', docId);
  if (!cfg) return 0;

  const rows = db.prepare(
    `SELECT payment_id, amount FROM payment_allocations WHERE ${cfg.column} = ?`
  ).all(docId);
  if (!rows.length) return 0;

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
