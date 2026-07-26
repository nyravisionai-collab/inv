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

    const result = db.prepare(`
      INSERT INTO customers (name, phone, email, address, city, state, pincode, gstin, pan, credit_limit, opening_balance, balance_type, current_balance, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      name, phone || null, email || null, address || null, city || null, state || null, pincode || null,
      gstin || null, pan || null, Number(credit_limit) || 0, Number(opening_balance) || 0,
      balance_type || 'debit', Number(opening_balance) || 0, notes || null
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
      ) WHERE 1=1 ${dateFilter.replace(/d/g, 'd')}
      ORDER BY d ASC, ref ASC
    `).all(req.params.id, req.params.id, req.params.id, ...(from_date ? [from_date] : []), ...(to_date ? [to_date] : []));

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
      SELECT c.*, 
        (SELECT COALESCE(SUM(balance_amount),0) FROM sales WHERE customer_id = c.id AND status='completed' AND balance_amount > 0) as outstanding
      FROM customers c WHERE c.is_active = 1 AND c.current_balance > 0
      ORDER BY c.current_balance DESC
    `).all();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, getById, create, update, remove, ledger, outstanding };
