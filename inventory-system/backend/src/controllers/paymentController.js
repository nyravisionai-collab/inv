const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { pageParams } = require('../utils/validate');
const { today, round2, sanitizeLike } = require('../utils/helpers');
const numberService = require('../services/numberService');
const partyService = require('../services/partyService');

function list(req, res) {
  try {
    const { page = 1, limit = 20, type, party_type, party_id, from_date, to_date, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (type) { where += ' AND p.payment_type = ?'; params.push(type); }
    if (party_type) { where += ' AND p.party_type = ?'; params.push(party_type); }
    if (party_id) { where += ' AND p.party_id = ?'; params.push(party_id); }
    if (from_date) { where += ' AND p.payment_date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND p.payment_date <= ?'; params.push(to_date); }
    if (search) {
      where += ' AND (p.payment_number LIKE ? ESCAPE \'!\' OR p.reference_number LIKE ? ESCAPE \'!\' OR p.notes LIKE ? ESCAPE \'!\')';
      const q = `%${sanitizeLike(search)}%`;
      params.push(q, q, q);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM payments p ${where}`).get(...params).c;
    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });

    const rows = db.prepare(`
      SELECT p.*, ba.account_name as bank_account_name,
        CASE
          WHEN p.party_type = 'customer' THEN (SELECT name FROM customers WHERE id = p.party_id)
          WHEN p.party_type = 'supplier' THEN (SELECT name FROM suppliers WHERE id = p.party_id)
        END as party_name
      FROM payments p
      LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
      ${where}
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, lim, offset);

    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getById(req, res) {
  try {
    const p = db.prepare(`
      SELECT p.*, ba.account_name as bank_account_name FROM payments p
      LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id WHERE p.id = ?
    `).get(req.params.id);
    if (!p) return error(res, 'Payment not found', 404);
    return success(res, p);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function create(req, res) {
  const txn = db.transaction(() => {
    const {
      payment_type, party_type, party_id, payment_date, amount,
      payment_mode = 'cash', bank_account_id, reference_number,
      cheque_number, cheque_date, notes, sale_id, purchase_id,
    } = req.body;

    if (!payment_type || !amount || amount <= 0) throw new Error('Payment type and valid amount required');

    const payNum = numberService.nextNumber(payment_type);
    const date = payment_date || today();

    let baId = bank_account_id;
    if (!baId) {
      const cash = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get();
      baId = cash?.id || null;
    }

    const result = db.prepare(`
      INSERT INTO payments (payment_number, payment_type, party_type, party_id, payment_date, amount, payment_mode, bank_account_id, reference_number, cheque_number, cheque_date, notes, sale_id, purchase_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      payNum, payment_type, party_type || null, party_id || null, date, Number(amount),
      payment_mode, baId, reference_number || null, cheque_number || null, cheque_date || null,
      notes || null, sale_id || null, purchase_id || null, req.user.id
    );

    // Update linked invoice
    if (sale_id) {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(sale_id);
      if (sale) {
        const newPaid = round2(sale.paid_amount + Number(amount));
        const newBalance = round2(sale.grand_total - newPaid);
        let ps = 'unpaid';
        if (newPaid >= sale.grand_total) ps = 'paid';
        else if (newPaid > 0) ps = 'partial';
        db.prepare('UPDATE sales SET paid_amount = ?, balance_amount = ?, payment_status = ? WHERE id = ?')
          .run(newPaid, Math.max(0, newBalance), ps, sale_id);
      }
    }

    if (purchase_id) {
      const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchase_id);
      if (purchase) {
        const newPaid = round2(purchase.paid_amount + Number(amount));
        const newBalance = round2(purchase.grand_total - newPaid);
        let ps = 'unpaid';
        if (newPaid >= purchase.grand_total) ps = 'paid';
        else if (newPaid > 0) ps = 'partial';
        db.prepare('UPDATE purchases SET paid_amount = ?, balance_amount = ?, payment_status = ? WHERE id = ?')
          .run(newPaid, Math.max(0, newBalance), ps, purchase_id);
      }
    }

    // Bank balance
    if (baId) {
      if (payment_type === 'payment_in') partyService.updateBankBalance(baId, amount, 'credit');
      else partyService.updateBankBalance(baId, amount, 'debit');
    }

    if (party_type === 'customer' && party_id) partyService.updateCustomerBalance(party_id);
    if (party_type === 'supplier' && party_id) partyService.updateSupplierBalance(party_id);

    return db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
  });

  try {
    const payment = txn();
    return success(res, payment, 'Payment recorded', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function remove(req, res) {
  try {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!p) return error(res, 'Payment not found', 404);
    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);

    if (p.sale_id) {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(p.sale_id);
      if (sale) {
        const newPaid = Math.max(0, round2(sale.paid_amount - p.amount));
        const newBalance = round2(sale.grand_total - newPaid);
        let ps = 'unpaid';
        if (newPaid >= sale.grand_total) ps = 'paid';
        else if (newPaid > 0) ps = 'partial';
        db.prepare('UPDATE sales SET paid_amount = ?, balance_amount = ?, payment_status = ? WHERE id = ?')
          .run(newPaid, newBalance, ps, p.sale_id);
      }
    }
    if (p.purchase_id) {
      const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(p.purchase_id);
      if (purchase) {
        const newPaid = Math.max(0, round2(purchase.paid_amount - p.amount));
        const newBalance = round2(purchase.grand_total - newPaid);
        let ps = 'unpaid';
        if (newPaid >= purchase.grand_total) ps = 'paid';
        else if (newPaid > 0) ps = 'partial';
        db.prepare('UPDATE purchases SET paid_amount = ?, balance_amount = ?, payment_status = ? WHERE id = ?')
          .run(newPaid, newBalance, ps, p.purchase_id);
      }
    }
    if (p.bank_account_id) {
      if (p.payment_type === 'payment_in') partyService.updateBankBalance(p.bank_account_id, p.amount, 'debit');
      else partyService.updateBankBalance(p.bank_account_id, p.amount, 'credit');
    }
    if (p.party_type === 'customer' && p.party_id) partyService.updateCustomerBalance(p.party_id);
    if (p.party_type === 'supplier' && p.party_id) partyService.updateSupplierBalance(p.party_id);

    return success(res, null, 'Payment deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, getById, create, remove };
