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

    const total = db.prepare(`SELECT COUNT(*) as c FROM suppliers ${where}`).get(...params).c;
    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });
    const rows = db.prepare(`SELECT * FROM suppliers ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, lim, offset);
    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getById(req, res) {
  try {
    const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!s) return error(res, 'Supplier not found', 404);
    return success(res, s);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function create(req, res) {
  try {
    const { name, phone, email, address, city, state, pincode, gstin, pan, opening_balance, balance_type, notes } = req.body;
    if (!name) return error(res, 'Supplier name is required');

    const opening = Number(opening_balance) || 0;
    const type = balance_type || 'credit';
    const current = type === 'debit' ? -opening : opening;
    const result = db.prepare(`
      INSERT INTO suppliers (name, phone, email, address, city, state, pincode, gstin, pan, opening_balance, balance_type, current_balance, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      name, phone || null, email || null, address || null, city || null, state || null, pincode || null,
      gstin || null, pan || null, opening, type,
      current, notes || null
    );

    return success(res, db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid), 'Supplier created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function update(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Supplier not found', 404);
    const b = req.body;

    db.prepare(`
      UPDATE suppliers SET name=?, phone=?, email=?, address=?, city=?, state=?, pincode=?, gstin=?, pan=?,
        notes=?, is_active=?, updated_at=? WHERE id=?
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
      b.notes !== undefined ? b.notes : existing.notes,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      now(), req.params.id
    );

    partyService.updateSupplierBalance(req.params.id);
    return success(res, db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id), 'Supplier updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function remove(req, res) {
  try {
    const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Supplier not found', 404);
    db.prepare('UPDATE suppliers SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), req.params.id);
    return success(res, null, 'Supplier deactivated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function ledger(req, res) {
  try {
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!supplier) return error(res, 'Supplier not found', 404);

    const entries = db.prepare(`
      SELECT * FROM (
        SELECT bill_date as d, bill_number as ref, 'Purchase' as type, grand_total as credit, 0 as debit, id as ref_id
        FROM purchases WHERE supplier_id = ? AND bill_type = 'purchase' AND status = 'completed'
        UNION ALL
        SELECT bill_date, bill_number, 'Purchase Return', 0, grand_total, id
        FROM purchases WHERE supplier_id = ? AND bill_type = 'purchase_return' AND status = 'completed'
        UNION ALL
        SELECT payment_date, payment_number, 'Payment Out', 0, amount, id
        FROM payments WHERE party_type = 'supplier' AND party_id = ? AND payment_type = 'payment_out'
        UNION ALL
        SELECT payment_date, payment_number, 'Refund In', amount, 0, id
        FROM payments WHERE party_type = 'supplier' AND party_id = ? AND payment_type = 'payment_in'
      ) ORDER BY d ASC
    `).all(req.params.id, req.params.id, req.params.id, req.params.id);

    let balance = supplier.balance_type === 'credit' ? Number(supplier.opening_balance || 0) : -Number(supplier.opening_balance || 0);
    const ledgerEntries = entries.map((e) => {
      balance += Number(e.credit || 0) - Number(e.debit || 0);
      return { ...e, balance: Math.round(balance * 100) / 100 };
    });

    return success(res, { supplier, opening_balance: supplier.opening_balance, entries: ledgerEntries, closing_balance: balance });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function outstanding(req, res) {
  try {
    const rows = db.prepare(`
      SELECT s.*, s.current_balance as outstanding, s.current_balance as payable
      FROM suppliers s WHERE s.is_active = 1 AND s.current_balance > 0
      ORDER BY s.current_balance DESC
    `).all();
    const openStmt = db.prepare(`
      SELECT bill_number, bill_date, due_date, balance_amount
      FROM purchases
      WHERE supplier_id = ? AND status = 'completed' AND payment_status IN ('unpaid', 'partial') AND balance_amount > 0
      ORDER BY bill_date ASC LIMIT 5
    `);
    for (const r of rows) {
      r.pending_bills = openStmt.all(r.id);
    }
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function sendReminder(req, res) {
  try {
    const { id } = req.params;
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    if (!supplier) return error(res, 'Supplier not found', 404);

    const openBills = db.prepare(`
      SELECT bill_number, bill_date, due_date, balance_amount
      FROM purchases
      WHERE supplier_id = ? AND status = 'completed' AND payment_status IN ('unpaid', 'partial') AND balance_amount > 0
      ORDER BY bill_date ASC LIMIT 5
    `).all(id);

    const company = db.prepare('SELECT company_name, currency_symbol FROM company_settings WHERE id = 1').get() || {};
    const sym = company.currency_symbol || '₹';
    const phone = (supplier.phone || '').replace(/\D/g, '');

    let detailsStr = openBills.map((b) => `- ${b.bill_number} (${b.bill_date}): ${sym}${Number(b.balance_amount).toFixed(2)}`).join('\n');
    if (!detailsStr) {
      detailsStr = `- Payable Balance: ${sym}${Number(supplier.current_balance).toFixed(2)}`;
    }

    const msg = encodeURIComponent(
      `*${company.company_name || 'Electricalskart'}*\nPayment Advice / Reminder for *${supplier.name}*\n\nPending Payable: ${sym}${Number(supplier.current_balance).toFixed(2)}\nPending Bills:\n${detailsStr}\n\nPlease find the details of outstanding bills. Thank you!`
    );
    const link = phone ? `https://wa.me/91${phone.slice(-10)}?text=${msg}` : `https://wa.me/?text=${msg}`;

    const timestamp = now();
    db.prepare('UPDATE suppliers SET last_reminder_at = ? WHERE id = ?').run(timestamp, id);

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
    if (!payload?.success) return error(res, payload?.message || 'Supplier ledger not found', 404);
    const data = payload.data;
    const { saveReportPdf } = require('../utils/exportPdf');
    const party = data.supplier;
    const file = await saveReportPdf({ name: `supplier-ledger-${party.id}-${Date.now()}`, title: `Supplier Ledger — ${party.name}`, data: { opening_balance: data.opening_balance, entries: data.entries, closing_balance: data.closing_balance } });
    return success(res, { fileName: file.fileName, folder: require('../config').exportDir }, 'Ledger PDF saved to system exports folder');
  } catch (err) { return error(res, err.message, 500); }
}

module.exports = { list, getById, create, update, remove, ledger, pdfLedger, outstanding, sendReminder };
