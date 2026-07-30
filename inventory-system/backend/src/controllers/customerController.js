const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { pageParams } = require('../utils/validate');
const { now, sanitizeLike } = require('../utils/helpers');
const partyService = require('../services/partyService');

function list(req, res) {
  try {
    const { page = 1, limit = 20, search, is_active } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (name LIKE ? ESCAPE \'!\' OR phone LIKE ? ESCAPE \'!\' OR email LIKE ? ESCAPE \'!\' OR gstin LIKE ? ESCAPE \'!\')';
      const s = `%${sanitizeLike(search)}%`;
      params.push(s, s, s, s);
    }
    if (is_active === undefined || is_active === '' || is_active === null) {
      where += ' AND is_active = 1';
    } else {
      where += ' AND is_active = ?';
      params.push(is_active === '1' || is_active === 'true' || is_active === true ? 1 : 0);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM customers ${where}`).get(...params).c;
    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });
    const rows = db.prepare(`SELECT * FROM customers ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, lim, offset);
    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getById(req, res) {
  try {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) return error(res, 'Customer not found', 404);
    return success(res, c);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function create(req, res) {
  try {
    const { name, phone, email, address, city, state, pincode, gstin, pan, credit_limit, opening_balance, balance_type, notes } = req.body;
    if (!name) return error(res, 'Customer name is required');

    const opening = Number(opening_balance) || 0;
    const type = balance_type || 'debit';
    const current = type === 'credit' ? -opening : opening;
    const result = db.prepare(`
      INSERT INTO customers (name, phone, email, address, city, state, pincode, gstin, pan, credit_limit, opening_balance, balance_type, current_balance, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      name, phone || null, email || null, address || null, city || null, state || null, pincode || null,
      gstin || null, pan || null, Number(credit_limit) || 0, opening,
      type, current, notes || null
    );

    return success(res, db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid), 'Customer created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function update(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Customer not found', 404);
    const b = req.body;

    db.prepare(`
      UPDATE customers SET name=?, phone=?, email=?, address=?, city=?, state=?, pincode=?, gstin=?, pan=?,
        credit_limit=?, notes=?, is_active=?, updated_at=? WHERE id=?
    `).run(
      b.name ?? existing.name,
      b.phone !== undefined ? b.phone : existing.phone,
      b.email !== undefined ? b.email : existing.email,
      b.address !== undefined ? b.address : existing.address,
      b.city !== undefined ? b.city : existing.city,
      b.state !== undefined ? b.state : existing.state,
      b.pincode !== undefined ? b.pincode : existing.pincode,
      b.gstin !== undefined ? b.gstin : existing.gstin,
      b.pan !== undefined ? b.pan : existing.pan,
      b.credit_limit !== undefined ? Number(b.credit_limit) : existing.credit_limit,
      b.notes !== undefined ? b.notes : existing.notes,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      now(), req.params.id
    );

    partyService.updateCustomerBalance(req.params.id);
    return success(res, db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id), 'Customer updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function remove(req, res) {
  try {
    const existing = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Customer not found', 404);
    db.prepare('UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), req.params.id);
    return success(res, null, 'Customer deactivated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function ledger(req, res) {
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) return error(res, 'Customer not found', 404);

    const { from_date, to_date } = req.query;
    let dateFilter = '';
    const params = [req.params.id];
    if (from_date) { dateFilter += ' AND d >= ?'; params.push(from_date); }
    if (to_date) { dateFilter += ' AND d <= ?'; params.push(to_date); }

    const entries = db.prepare(`
      SELECT * FROM (
        SELECT invoice_date as d, invoice_number as ref, 'Sale' as type, grand_total as debit, 0 as credit, id as ref_id, 'sale' as ref_type
        FROM sales WHERE customer_id = ? AND invoice_type IN ('sale','pos') AND status = 'completed'
        UNION ALL
        SELECT invoice_date, invoice_number, 'Sale Return', 0, grand_total, id, 'sale_return'
        FROM sales WHERE customer_id = ? AND invoice_type = 'sale_return' AND status = 'completed'
        UNION ALL
        SELECT payment_date, payment_number, 'Payment In', 0, amount, id, 'payment'
        FROM payments WHERE party_type = 'customer' AND party_id = ? AND payment_type = 'payment_in'
        UNION ALL
        SELECT payment_date, payment_number, 'Refund Out', amount, 0, id, 'payment'
        FROM payments WHERE party_type = 'customer' AND party_id = ? AND payment_type = 'payment_out'
      ) WHERE 1=1 ${dateFilter.replace(/d/g, 'd')}
      ORDER BY d ASC, ref ASC
    `).all(req.params.id, req.params.id, req.params.id, req.params.id, ...(from_date ? [from_date] : []), ...(to_date ? [to_date] : []));

    let balance = customer.balance_type === 'debit' ? Number(customer.opening_balance || 0) : -Number(customer.opening_balance || 0);
    const ledger = entries.map((e) => {
      balance += Number(e.debit || 0) - Number(e.credit || 0);
      return { ...e, balance: Math.round(balance * 100) / 100 };
    });

    return success(res, { customer, opening_balance: customer.opening_balance, entries: ledger, closing_balance: balance });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function outstanding(req, res) {
  try {
    const rows = db.prepare(`
      SELECT c.*, c.current_balance as outstanding
      FROM customers c WHERE c.is_active = 1 AND c.current_balance > 0
      ORDER BY c.current_balance DESC
    `).all();
    const openStmt = db.prepare(`
      SELECT invoice_number, invoice_date, due_date, balance_amount
      FROM sales
      WHERE customer_id = ? AND status = 'completed' AND payment_status IN ('unpaid', 'partial') AND balance_amount > 0
      ORDER BY invoice_date ASC LIMIT 5
    `);
    for (const r of rows) {
      r.pending_invoices = openStmt.all(r.id);
    }
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function sendReminder(req, res) {
  try {
    const { id } = req.params;
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!customer) return error(res, 'Customer not found', 404);

    const openInvoices = db.prepare(`
      SELECT invoice_number, invoice_date, due_date, balance_amount
      FROM sales
      WHERE customer_id = ? AND status = 'completed' AND payment_status IN ('unpaid', 'partial') AND balance_amount > 0
      ORDER BY invoice_date ASC LIMIT 5
    `).all(id);

    const company = db.prepare('SELECT company_name, currency_symbol FROM company_settings WHERE id = 1').get() || {};
    const sym = company.currency_symbol || '₹';
    const phone = (customer.phone || '').replace(/\D/g, '');

    let detailsStr = openInvoices.map((inv) => `- ${inv.invoice_number} (${inv.invoice_date}): ${sym}${Number(inv.balance_amount).toFixed(2)}`).join('\n');
    if (!detailsStr) {
      detailsStr = `- Outstanding Balance: ${sym}${Number(customer.current_balance).toFixed(2)}`;
    }

    const msg = encodeURIComponent(
      `*${company.company_name || 'Electricalskart'}*\nPayment Reminder for *${customer.name}*\n\nPending Balance: ${sym}${Number(customer.current_balance).toFixed(2)}\nPending Invoices:\n${detailsStr}\n\nPlease clear the dues at your earliest convenience. Thank you!`
    );
    const link = phone ? `https://wa.me/91${phone.slice(-10)}?text=${msg}` : `https://wa.me/?text=${msg}`;

    const timestamp = now();
    db.prepare('UPDATE customers SET last_reminder_at = ? WHERE id = ?').run(timestamp, id);

    return success(res, { link, message: decodeURIComponent(msg), last_reminder_at: timestamp }, 'Reminder generated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}


async function pdfLedger(req, res) {
  let payload;
  const collector = { status() { return this; }, json(body) { payload = body; return body; } };
  try {
    ledger(req, collector);
    if (!payload?.success) return error(res, payload?.message || 'Customer ledger not found', 404);
    const data = payload.data;
    const { saveReportPdf } = require('../utils/exportPdf');
    const party = data.customer;
    const file = await saveReportPdf({ name: `customer-ledger-${party.id}-${Date.now()}`, title: `Customer Ledger — ${party.name}`, data: { opening_balance: data.opening_balance, entries: data.entries, closing_balance: data.closing_balance } });
    return success(res, { fileName: file.fileName, folder: require('../config').exportDir }, 'Ledger PDF saved to system exports folder');
  } catch (err) { return error(res, err.message, 500); }
}

module.exports = { list, getById, create, update, remove, ledger, pdfLedger, outstanding, sendReminder };
