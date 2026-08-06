const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { now, paginate, sanitizeLike } = require('../utils/helpers');
const partyService = require('../services/partyService');

function list(req, res) {
  try {
    const { page = 1, limit = 20, search, is_active, outstanding } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (is_active !== undefined) {
      where += ' AND is_active = ?';
      params.push(Number(is_active));
    }

    if (outstanding === '1') {
      where += ' AND current_balance != 0';
    }

    if (search) {
      where += ' AND (name LIKE ? ESCAPE \'!\' OR phone LIKE ? ESCAPE \'!\' OR city LIKE ? ESCAPE \'!\')';
      const q = `%${sanitizeLike(search)}%`;
      params.push(q, q, q);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM parties ${where}`).get(...params).c;
    const p = paginate(`SELECT * FROM parties ${where} ORDER BY name ASC`, params, page, limit);
    const rows = db.prepare(p.sql).all(...p.params);

    return paginated(res, rows, total, p.page, p.limit);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getById(req, res) {
  try {
    const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(req.params.id);
    if (!party) return error(res, 'Party not found', 404);
    return success(res, party);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function create(req, res) {
  try {
    const {
      name, phone, email, address, city, state, pincode, gstin, pan,
      credit_limit, opening_balance, balance_type, notes,
    } = req.body;

    if (!name) return error(res, 'Name is required', 400);

    const result = db.prepare(`
      INSERT INTO parties (
        name, phone, email, address, city, state, pincode, gstin, pan,
        credit_limit, opening_balance, balance_type, current_balance, notes
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      name, phone || null, email || null, address || null, city || null,
      state || null, pincode || null, gstin || null, pan || null,
      Number(credit_limit) || 0, Number(opening_balance) || 0, balance_type || 'debit',
      balance_type === 'debit' ? Number(opening_balance || 0) : -Number(opening_balance || 0),
      notes || null
    );

    const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(result.lastInsertRowid);
    return success(res, party, 'Party created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function update(req, res) {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
    if (!existing) return error(res, 'Party not found', 404);

    const b = req.body;
    db.prepare(`
      UPDATE parties SET
        name=?, phone=?, email=?, address=?, city=?, state=?, pincode=?, gstin=?, pan=?,
        credit_limit=?, notes=?, updated_at=?
      WHERE id = ?
    `).run(
      b.name || existing.name,
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
      now(),
      id
    );

    partyService.updatePartyBalance(id);
    const updated = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
    return success(res, updated, 'Party updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function remove(req, res) {
  try {
    db.prepare('UPDATE parties SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), req.params.id);
    return success(res, null, 'Party deactivated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, getById, create, update, remove };

function ledger(req, res) {
  try {
    const id = req.params.id;
    const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
    if (!party) return error(res, 'Party not found', 404);

    const sales = db.prepare(`
      SELECT 'sale' as type, invoice_number as ref, invoice_date as d, grand_total as amount, paid_amount as paid, balance_amount as bal, status
      FROM sales WHERE party_id = ? AND invoice_type IN ('sale','pos')
    `).all(id);

    const purchases = db.prepare(`
      SELECT 'purchase' as type, bill_number as ref, bill_date as d, grand_total as amount, paid_amount as paid, balance_amount as bal, status
      FROM purchases WHERE party_id = ? AND bill_type = 'purchase'
    `).all(id);

    const payments = db.prepare(`
      SELECT 'payment' as type, payment_number as ref, payment_date as d, amount, 0 as paid, 0 as bal, 'completed' as status
      FROM payments WHERE party_id = ?
    `).all(id);

    // Combine and sort by date
    const entries = [...sales, ...purchases, ...payments].sort((a, b) => new Date(b.d) - new Date(a.d));

    return success(res, { party, entries, opening_balance: party.opening_balance, closing_balance: party.current_balance });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports.ledger = ledger;
