const db = require('../db/database');
const { round2, now } = require('../utils/helpers');

function updateCustomerBalance(customerId) {
  const customer = db.prepare('SELECT opening_balance, balance_type FROM customers WHERE id = ?').get(customerId);
  if (!customer) return;

  let balance = customer.balance_type === 'debit' ? Number(customer.opening_balance || 0) : -Number(customer.opening_balance || 0);

  const sales = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM sales WHERE customer_id = ? AND invoice_type IN ('sale','pos') AND status = 'completed'
  `).get(customerId);
  balance += Number(sales.total) - Number(sales.paid);

  const returns = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM sales WHERE customer_id = ? AND invoice_type = 'sale_return' AND status = 'completed'
  `).get(customerId);
  balance -= Number(returns.total) - Number(returns.paid);

  const payments = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM payments
    WHERE party_type = 'customer' AND party_id = ? AND payment_type = 'payment_in' AND sale_id IS NULL
  `).get(customerId);
  balance -= Number(payments.total);

  db.prepare("UPDATE customers SET current_balance = ?, updated_at = ? WHERE id = ?").run(round2(balance), now(), customerId);
  return round2(balance);
}

function updateSupplierBalance(supplierId) {
  const supplier = db.prepare('SELECT opening_balance, balance_type FROM suppliers WHERE id = ?').get(supplierId);
  if (!supplier) return;

  let balance = supplier.balance_type === 'credit' ? Number(supplier.opening_balance || 0) : -Number(supplier.opening_balance || 0);

  const purchases = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM purchases WHERE supplier_id = ? AND bill_type = 'purchase' AND status = 'completed'
  `).get(supplierId);
  balance += Number(purchases.total) - Number(purchases.paid);

  const returns = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
    FROM purchases WHERE supplier_id = ? AND bill_type = 'purchase_return' AND status = 'completed'
  `).get(supplierId);
  balance -= Number(returns.total) - Number(returns.paid);

  const payments = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM payments
    WHERE party_type = 'supplier' AND party_id = ? AND payment_type = 'payment_out' AND purchase_id IS NULL
  `).get(supplierId);
  balance -= Number(payments.total);

  db.prepare("UPDATE suppliers SET current_balance = ?, updated_at = ? WHERE id = ?").run(round2(balance), now(), supplierId);
  return round2(balance);
}

function updateBankBalance(bankAccountId, amount, type = 'credit') {
  const acc = db.prepare('SELECT current_balance FROM bank_accounts WHERE id = ?').get(bankAccountId);
  if (!acc) return;
  const delta = type === 'credit' ? Number(amount) : -Number(amount);
  db.prepare("UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ?")
    .run(round2(acc.current_balance + delta), now(), bankAccountId);
}

module.exports = { updateCustomerBalance, updateSupplierBalance, updateBankBalance };
