const db = require('../db/database');
const { round2, now } = require('../utils/helpers');

function updatePartyBalance(partyId) {
  const party = db.prepare('SELECT opening_balance, balance_type FROM parties WHERE id = ?').get(partyId);
  if (!party) return;

  // Opening balance: debit is + (customer owes us), credit is - (we owe supplier)
  // Actually, for a unified balance:
  // Let's treat it as: Balance = (All Sales to party) - (All Payments from party) - (All Purchases from party) + (All Payments to party)
  // Positive balance = Party owes us (Customer)
  // Negative balance = We owe party (Supplier)
  
  let balance = party.balance_type === 'debit' ? Number(party.opening_balance || 0) : -Number(party.opening_balance || 0);

  // 1. Sales (Invoices + POS) - Adds to what they owe us
  const sales = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM sales WHERE party_id = ? AND invoice_type IN ('sale','pos') AND status = 'completed'
  `).get(partyId);
  balance += (Number(sales.total) - Number(sales.paid));

  // 2. Sale Returns - Subtracts from what they owe us
  const sReturns = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM sales WHERE party_id = ? AND invoice_type = 'sale_return' AND status = 'completed'
  `).get(partyId);
  balance -= (Number(sReturns.total) - Number(sReturns.paid));

  // 3. Purchases - Subtracts from balance (we owe them)
  const purchases = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM purchases WHERE party_id = ? AND bill_type = 'purchase' AND status = 'completed'
  `).get(partyId);
  balance -= (Number(purchases.total) - Number(purchases.paid));

  // 4. Purchase Returns - Adds to balance (they owe us or reduces what we owe)
  const pReturns = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM purchases WHERE party_id = ? AND bill_type = 'purchase_return' AND status = 'completed'
  `).get(partyId);
  balance += (Number(pReturns.total) - Number(pReturns.paid));

  // 5. Unallocated Payments IN (Customer payments) - Subtracts from balance
  const paymentsIn = db.prepare(`
    SELECT COALESCE(SUM(p.amount - COALESCE(
      (SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0
    )), 0) as total
    FROM payments p
    WHERE p.party_id = ? AND p.payment_type = 'payment_in'
  `).get(partyId);
  balance -= Number(paymentsIn.total);

  // 6. Unallocated Payments OUT (Payments to supplier) - Adds to balance
  const paymentsOut = db.prepare(`
    SELECT COALESCE(SUM(p.amount - COALESCE(
      (SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0
    )), 0) as total
    FROM payments p
    WHERE p.party_id = ? AND p.payment_type = 'payment_out'
  `).get(partyId);
  balance += Number(paymentsOut.total);

  db.prepare("UPDATE parties SET current_balance = ?, updated_at = ? WHERE id = ?").run(round2(balance), now(), partyId);
  return round2(balance);
}

// Keep old exports for compatibility during transition if needed
function updateCustomerBalance(id) { return updatePartyBalance(id); }
function updateSupplierBalance(id) { return updatePartyBalance(id); }

function updateBankBalance(bankAccountId, amount, type = 'credit') {
  const acc = db.prepare('SELECT current_balance FROM bank_accounts WHERE id = ?').get(bankAccountId);
  if (!acc) return;
  const delta = type === 'credit' ? Number(amount) : -Number(amount);
  db.prepare("UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ?")
    .run(round2(acc.current_balance + delta), now(), bankAccountId);
}

module.exports = { updatePartyBalance, updateCustomerBalance, updateSupplierBalance, updateBankBalance };

function updatePartyBalance(partyId) {
  const party = db.prepare('SELECT opening_balance, balance_type FROM parties WHERE id = ?').get(partyId);
  if (!party) return;

  // Opening balance: debit is + (receivable), credit is - (payable)
  let balance = party.balance_type === 'debit' ? Number(party.opening_balance || 0) : -Number(party.opening_balance || 0);

  // 1. Sales (Invoices + POS) - Increases receivable
  const sales = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM sales WHERE party_id = ? AND invoice_type IN ('sale','pos') AND status = 'completed'
  `).get(partyId);
  balance += (Number(sales.total) - Number(sales.paid));

  // 2. Sale Returns - Decreases receivable
  const sReturns = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM sales WHERE party_id = ? AND invoice_type = 'sale_return' AND status = 'completed'
  `).get(partyId);
  balance -= (Number(sReturns.total) - Number(sReturns.paid));

  // 3. Purchases - Increases payable (decreases balance)
  const purchases = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM purchases WHERE party_id = ? AND bill_type = 'purchase' AND status = 'completed'
  `).get(partyId);
  balance -= (Number(purchases.total) - Number(purchases.paid));

  // 4. Purchase Returns - Decreases payable (increases balance)
  const pReturns = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM purchases WHERE party_id = ? AND bill_type = 'purchase_return' AND status = 'completed'
  `).get(partyId);
  balance += (Number(pReturns.total) - Number(pReturns.paid));

  // 5. Unallocated Payments IN (Receiving money) - Decreases balance
  const paymentsIn = db.prepare(`
    SELECT COALESCE(SUM(p.amount - COALESCE(
      (SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0
    )), 0) as total
    FROM payments p
    WHERE p.party_id = ? AND p.payment_type = 'payment_in'
  `).get(partyId);
  balance -= Number(paymentsIn.total);

  // 6. Unallocated Payments OUT (Paying money) - Increases balance
  const paymentsOut = db.prepare(`
    SELECT COALESCE(SUM(p.amount - COALESCE(
      (SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0
    )), 0) as total
    FROM payments p
    WHERE p.party_id = ? AND p.payment_type = 'payment_out'
  `).get(partyId);
  balance += Number(paymentsOut.total);

  db.prepare("UPDATE parties SET current_balance = ?, updated_at = ? WHERE id = ?").run(round2(balance), now(), partyId);
  return round2(balance);
}
