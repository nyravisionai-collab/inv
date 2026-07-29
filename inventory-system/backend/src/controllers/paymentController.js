const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { pageParams, toNumber, oneOf, optionalDate } = require('../utils/validate');
const { today, round2, sanitizeLike } = require('../utils/helpers');
const numberService = require('../services/numberService');
const partyService = require('../services/partyService');
const paymentService = require('../services/paymentService');

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
      party_id, payment_mode = 'cash', bank_account_id, reference_number,
      cheque_number, cheque_date, notes, sale_id, purchase_id,
    } = req.body;

    // Validate before touching the database: an unknown payment_type used to
    // fall through to a raw SQLite CHECK-constraint 500, and a NaN amount was
    // inserted as NULL.
    const payment_type = oneOf(req.body.payment_type, ['payment_in', 'payment_out'], 'Payment type');
    const party_type = req.body.party_type
      ? oneOf(req.body.party_type, ['customer', 'supplier'], 'Party type')
      : null;
    const amount = toNumber(req.body.amount, 'Amount', { min: 0 });
    if (amount <= 0) {
      throw Object.assign(new Error('Amount must be greater than zero'), { status: 400, code: 'ERR_AMOUNT_POSITIVE' });
    }

    const payNum = numberService.nextNumber(payment_type);
    const date = optionalDate(req.body.payment_date, 'Payment date') || today();

    let baId = bank_account_id;
    if (!baId) {
      const cash = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get();
      baId = cash?.id || null;
    }

    const result = db.prepare(`
      INSERT INTO payments (payment_number, payment_type, party_type, party_id, payment_date, amount, payment_mode, bank_account_id, reference_number, cheque_number, cheque_date, notes, sale_id, purchase_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      payNum, payment_type, party_type || null, party_id || null, date, amount,
      payment_mode, baId, reference_number || null, cheque_number || null, cheque_date || null,
      notes || null, sale_id || null, purchase_id || null, req.user.id
    );

    // Settle the money against the party's open bills. A payment aimed at one
    // invoice clears that invoice; a plain "Record Payment" for a customer is
    // spread over their oldest unpaid documents, so the amount stops being
    // reported as receivable/payable on the dashboard.
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
    const unapplied = paymentService.allocatePayment(payment);

    // Bank balance
    if (baId) {
      if (payment_type === 'payment_in') partyService.updateBankBalance(baId, amount, 'credit');
      else partyService.updateBankBalance(baId, amount, 'debit');
    }

    if (party_type === 'customer' && party_id) partyService.updateCustomerBalance(party_id);
    if (party_type === 'supplier' && party_id) partyService.updateSupplierBalance(party_id);

    const saved = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
    // Anything left over is an advance sitting on the party's account.
    return { ...saved, unallocated_amount: round2(unapplied) };
  });

  try {
    const payment = txn();
    return success(res, payment, 'Payment recorded', 201);
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

function remove(req, res) {
  const txn = db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!p) throw Object.assign(new Error('Payment not found'), { status: 404, code: 'ERR_NOT_FOUND' });

    // Put back exactly what this payment settled, then remove it.
    paymentService.releasePayment(p.id);
    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);

    if (p.bank_account_id) {
      if (p.payment_type === 'payment_in') partyService.updateBankBalance(p.bank_account_id, p.amount, 'debit');
      else partyService.updateBankBalance(p.bank_account_id, p.amount, 'credit');
    }
    if (p.party_type === 'customer' && p.party_id) partyService.updateCustomerBalance(p.party_id);
    if (p.party_type === 'supplier' && p.party_id) partyService.updateSupplierBalance(p.party_id);
  });

  try {
    txn();
    return success(res, null, 'Payment deleted');
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
  }
}


async function pdfReceipt(req, res) {
  try {
    const payment = db.prepare(`SELECT p.*, ba.account_name bank_account_name,
      CASE WHEN p.party_type='customer' THEN (SELECT name FROM customers WHERE id=p.party_id)
           WHEN p.party_type='supplier' THEN (SELECT name FROM suppliers WHERE id=p.party_id) END party_name
      FROM payments p LEFT JOIN bank_accounts ba ON ba.id=p.bank_account_id WHERE p.id=?`).get(req.params.id);
    if (!payment) return error(res, 'Payment not found', 404);
    const { saveReportPdf } = require('../utils/exportPdf');
    const file = await saveReportPdf({ name: `payment-receipt-${payment.payment_number}`, title: payment.payment_type === 'payment_in' ? 'PAYMENT RECEIPT' : 'PAYMENT VOUCHER', data: {
      receipt_number: payment.payment_number, date: payment.payment_date, party: payment.party_name || '—',
      payment_mode: payment.payment_mode, bank_account: payment.bank_account_name || '—', reference: payment.reference_number || payment.cheque_number || '—', amount: payment.amount, notes: payment.notes || '—' } });
    return success(res, { fileName: file.fileName, folder: require('../config').exportDir }, 'Payment PDF saved to system exports folder');
  } catch (err) { return error(res, err.message, 500); }
}

module.exports = { list, getById, create, remove, pdfReceipt };
