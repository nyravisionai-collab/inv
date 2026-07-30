const db = require('../db/database');
const fs = require('fs');
const path = require('path');
const { success, error } = require('../utils/response');
const { now } = require('../utils/helpers');
const config = require('../config');
const { csvSafeRows } = require('../utils/sanitize');
const xlsxUtil = require('../utils/xlsx');

function getSettings(req, res) {
  try {
    const settings = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
    return success(res, settings);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function updateSettings(req, res) {
  try {
    const b = req.body;
    const existing = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
    if (!existing) return error(res, 'Settings not found', 404);

    const fields = [
      'company_name', 'legal_name', 'address', 'city', 'state', 'pincode', 'country',
      'phone', 'email', 'website', 'gstin', 'pan', 'currency', 'currency_symbol',
      'fiscal_year_start', 'invoice_prefix', 'purchase_prefix', 'estimate_prefix',
      'sale_order_prefix', 'challan_prefix', 'payment_in_prefix', 'payment_out_prefix',
      'tax_enabled', 'default_tax_rate', 'invoice_template', 'invoice_terms', 'invoice_notes',
      'theme', 'language', 'timezone', 'low_stock_alert', 'backup_auto',
    ];

    const updates = [];
    const values = [];
    for (const f of fields) {
      if (b[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(b[f]);
      }
    }
    updates.push('updated_at = ?');
    values.push(now());
    values.push(1);

    db.prepare(`UPDATE company_settings SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return success(res, db.prepare('SELECT * FROM company_settings WHERE id = 1').get(), 'Settings updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function uploadLogo(req, res) {
  try {
    if (!req.file) return error(res, 'No file uploaded');
    const logoPath = `/uploads/logos/${req.file.filename}`;
    db.prepare('UPDATE company_settings SET logo_path = ?, updated_at = ? WHERE id = 1').run(logoPath, now());
    return success(res, { logo_path: logoPath }, 'Logo uploaded');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function uploadSignature(req, res) {
  try {
    if (!req.file) return error(res, 'No file uploaded');
    const signaturePath = `/uploads/signatures/${req.file.filename}`;
    db.prepare('UPDATE company_settings SET signature_path = ?, updated_at = ? WHERE id = 1').run(signaturePath, now());
    return success(res, { signature_path: signaturePath }, 'Signature uploaded');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function deleteSignature(req, res) {
  try {
    const existing = db.prepare('SELECT signature_path FROM company_settings WHERE id = 1').get();
    if (existing && existing.signature_path) {
      const p = path.join(config.uploadDir, String(existing.signature_path).replace(/^\/uploads\//, ''));
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
    }
    db.prepare('UPDATE company_settings SET signature_path = NULL, updated_at = ? WHERE id = 1').run(now());
    return success(res, null, 'Signature removed');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function listTaxRates(req, res) {
  try {
    return success(res, db.prepare('SELECT * FROM tax_rates WHERE is_active = 1 ORDER BY rate').all());
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createTaxRate(req, res) {
  try {
    const { name, rate, cgst, sgst, igst } = req.body;
    if (!name || rate === undefined) return error(res, 'Name and rate required');
    const r = Number(rate);
    const inactive = db.prepare('SELECT * FROM tax_rates WHERE name = ? AND is_active = 0').get(name);
    if (inactive) {
      db.prepare('UPDATE tax_rates SET rate=?, cgst=?, sgst=?, igst=?, is_active=1 WHERE id=?')
        .run(r, cgst !== undefined ? cgst : r / 2, sgst !== undefined ? sgst : r / 2, igst !== undefined ? igst : r, inactive.id);
      return success(res, db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(inactive.id), 'Tax rate restored', 201);
    }
    const result = db.prepare('INSERT INTO tax_rates (name, rate, cgst, sgst, igst) VALUES (?,?,?,?,?)')
      .run(name, r, cgst !== undefined ? cgst : r / 2, sgst !== undefined ? sgst : r / 2, igst !== undefined ? igst : r);
    return success(res, db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(result.lastInsertRowid), 'Tax rate created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function deleteTaxRate(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    db.prepare('UPDATE tax_rates SET is_active = 0 WHERE id = ?').run(req.params.id);
    return success(res, null, 'Tax rate deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function backup(req, res) {
  try {
    const backupDir = path.resolve(config.backupDir);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbPath = path.resolve(config.dbPath);
    const backupPath = path.join(backupDir, `backup-${timestamp}.db`);

    // Persist in-memory sql.js DB to disk, then copy
    try {
      db.persist();
    } catch {
      /* ignore */
    }
    if (!fs.existsSync(dbPath)) {
      // Fallback: export raw bytes
      const data = db.raw.export();
      fs.writeFileSync(backupPath, Buffer.from(data));
    } else {
      fs.copyFileSync(dbPath, backupPath);
    }

    // Also export JSON
    const tables = [
      'users', 'company_settings', 'categories', 'brands', 'units', 'warehouses',
      'products', 'customers', 'suppliers', 'bank_accounts', 'sales', 'sale_items',
      'purchases', 'purchase_items', 'payments', 'expenses', 'incomes', 'tax_rates',
    ];
    const jsonData = {};
    for (const t of tables) {
      try { jsonData[t] = db.prepare(`SELECT * FROM ${t}`).all(); } catch { jsonData[t] = []; }
    }
    const jsonPath = path.join(backupDir, `backup-${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));

    return success(res, {
      db_backup: path.basename(backupPath),
      json_backup: path.basename(jsonPath),
      size: fs.statSync(backupPath).size,
      created_at: timestamp,
    }, 'Backup created');
  } catch (err) {
    return error(res, err.message, 500);
  }
}


function exportPdf(req, res) {
  try {
    const { type } = req.params;
    const q = { ...req.query, ...(req.body || {}) };
    const { saveReportPdf } = require('../utils/exportPdf');

    let rows = [];
    let title = `${type.toUpperCase()} EXPORT`;
    let subtitle = '';
    const filterParts = [];

    if (type === 'products' || type === 'stock') {
      let where = 'WHERE is_active=1';
      const params = [];
      if (q.category_id) { where += ' AND category_id = ?'; params.push(q.category_id); filterParts.push(`Category ID: ${q.category_id}`); }
      if (q.brand_id) { where += ' AND brand_id = ?'; params.push(q.brand_id); filterParts.push(`Brand ID: ${q.brand_id}`); }
      if (q.low_stock === '1') { where += ' AND current_stock <= min_stock AND min_stock > 0'; filterParts.push('Low Stock: Yes'); }
      if (q.search) {
        where += " AND (name LIKE ? ESCAPE '!' OR sku LIKE ? ESCAPE '!')";
        const s = `%${q.search}%`; params.push(s, s); filterParts.push(`Search: "${q.search}"`);
      }
      rows = db.prepare(`SELECT sku, name, current_stock, purchase_price, selling_price FROM products ${where} ORDER BY name`).all(...params);
      const totalQty = rows.reduce((acc, r) => acc + Number(r.current_stock || 0), 0);
      const totalVal = rows.reduce((acc, r) => acc + (Number(r.current_stock || 0) * Number(r.purchase_price || 0)), 0);
      subtitle = `Applied Filters: ${filterParts.join(' | ') || 'None'} | Totals: ${rows.length} Items, Qty: ${totalQty}, Valuation: ₹${totalVal.toFixed(2)}`;
    } else if (type === 'sales') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q.type) {
        const types = String(q.type).split(',').map((x) => x.trim()).filter(Boolean);
        if (types.length) { where += ` AND invoice_type IN (${types.map(() => '?').join(',')})`; params.push(...types); filterParts.push(`Type: ${types.join(',')}`); }
      } else { where += " AND invoice_type IN ('sale','pos')"; }
      if (q.status) { where += ' AND status = ?'; params.push(q.status); filterParts.push(`Status: ${q.status}`); }
      if (q.payment_status) { where += ' AND payment_status = ?'; params.push(q.payment_status); filterParts.push(`Payment: ${q.payment_status}`); }
      if (q.customer_id) { where += ' AND customer_id = ?'; params.push(q.customer_id); filterParts.push(`Customer ID: ${q.customer_id}`); }
      if (q.from_date) { where += ' AND invoice_date >= ?'; params.push(q.from_date); filterParts.push(`From: ${q.from_date}`); }
      if (q.to_date) { where += ' AND invoice_date <= ?'; params.push(q.to_date); filterParts.push(`To: ${q.to_date}`); }
      rows = db.prepare(`SELECT invoice_number, invoice_date, invoice_type, grand_total, paid_amount, balance_amount, status FROM sales ${where} ORDER BY id DESC`).all(...params);
      const totalAmt = rows.reduce((acc, r) => acc + Number(r.grand_total || 0), 0);
      const totalPaid = rows.reduce((acc, r) => acc + Number(r.paid_amount || 0), 0);
      subtitle = `Applied Filters: ${filterParts.join(' | ') || 'None'} | Totals: ${rows.length} Invoices, Amount: ₹${totalAmt.toFixed(2)}, Paid: ₹${totalPaid.toFixed(2)}`;
    } else if (type === 'purchases') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q.type) { where += ' AND bill_type = ?'; params.push(q.type); filterParts.push(`Type: ${q.type}`); }
      else { where += " AND bill_type = 'purchase'"; }
      if (q.status) { where += ' AND status = ?'; params.push(q.status); filterParts.push(`Status: ${q.status}`); }
      if (q.payment_status) { where += ' AND payment_status = ?'; params.push(q.payment_status); filterParts.push(`Payment: ${q.payment_status}`); }
      if (q.supplier_id) { where += ' AND supplier_id = ?'; params.push(q.supplier_id); filterParts.push(`Supplier ID: ${q.supplier_id}`); }
      if (q.from_date) { where += ' AND bill_date >= ?'; params.push(q.from_date); filterParts.push(`From: ${q.from_date}`); }
      if (q.to_date) { where += ' AND bill_date <= ?'; params.push(q.to_date); filterParts.push(`To: ${q.to_date}`); }
      rows = db.prepare(`SELECT bill_number, bill_date, bill_type, grand_total, paid_amount, balance_amount, status FROM purchases ${where} ORDER BY id DESC`).all(...params);
      const totalAmt = rows.reduce((acc, r) => acc + Number(r.grand_total || 0), 0);
      const totalPaid = rows.reduce((acc, r) => acc + Number(r.paid_amount || 0), 0);
      subtitle = `Applied Filters: ${filterParts.join(' | ') || 'None'} | Totals: ${rows.length} Bills, Amount: ₹${totalAmt.toFixed(2)}, Paid: ₹${totalPaid.toFixed(2)}`;
    } else if (type === 'payments') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q.type) { where += ' AND payment_type = ?'; params.push(q.type); filterParts.push(`Type: ${q.type}`); }
      if (q.party_type) { where += ' AND party_type = ?'; params.push(q.party_type); filterParts.push(`Party Type: ${q.party_type}`); }
      if (q.party_id) { where += ' AND party_id = ?'; params.push(q.party_id); filterParts.push(`Party ID: ${q.party_id}`); }
      if (q.from_date) { where += ' AND payment_date >= ?'; params.push(q.from_date); filterParts.push(`From: ${q.from_date}`); }
      if (q.to_date) { where += ' AND payment_date <= ?'; params.push(q.to_date); filterParts.push(`To: ${q.to_date}`); }
      rows = db.prepare(`SELECT payment_number, payment_date, payment_type, amount, payment_mode FROM payments ${where} ORDER BY id DESC`).all(...params);
      const totalAmt = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
      subtitle = `Applied Filters: ${filterParts.join(' | ') || 'None'} | Totals: ${rows.length} Payments, Amount: ₹${totalAmt.toFixed(2)}`;
    } else if (type === 'expenses') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q.category) { where += ' AND category = ?'; params.push(q.category); filterParts.push(`Category: ${q.category}`); }
      if (q.from_date) { where += ' AND expense_date >= ?'; params.push(q.from_date); filterParts.push(`From: ${q.from_date}`); }
      if (q.to_date) { where += ' AND expense_date <= ?'; params.push(q.to_date); filterParts.push(`To: ${q.to_date}`); }
      rows = db.prepare(`SELECT expense_number, expense_date, category, amount, payment_mode FROM expenses ${where} ORDER BY id DESC`).all(...params);
      const totalAmt = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
      subtitle = `Applied Filters: ${filterParts.join(' | ') || 'None'} | Totals: ${rows.length} Expenses, Amount: ₹${totalAmt.toFixed(2)}`;
    } else if (type === 'customers') {
      let where = 'WHERE is_active=1';
      const params = [];
      if (q.outstanding === '1') { where += ' AND current_balance > 0'; filterParts.push('With Dues Only'); }
      if (q.search) { where += " AND (name LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!')"; const s = `%${q.search}%`; params.push(s, s); filterParts.push(`Search: "${q.search}"`); }
      rows = db.prepare(`SELECT name, phone, gstin, current_balance FROM customers ${where} ORDER BY name`).all(...params);
      const totalBal = rows.reduce((acc, r) => acc + Number(r.current_balance || 0), 0);
      subtitle = `Applied Filters: ${filterParts.join(' | ') || 'None'} | Totals: ${rows.length} Customers, Outstanding: ₹${totalBal.toFixed(2)}`;
    } else if (type === 'suppliers') {
      let where = 'WHERE is_active=1';
      const params = [];
      if (q.outstanding === '1') { where += ' AND current_balance > 0'; filterParts.push('With Dues Only'); }
      if (q.search) { where += " AND (name LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!')"; const s = `%${q.search}%`; params.push(s, s); filterParts.push(`Search: "${q.search}"`); }
      rows = db.prepare(`SELECT name, phone, gstin, current_balance FROM suppliers ${where} ORDER BY name`).all(...params);
      const totalBal = rows.reduce((acc, r) => acc + Number(r.current_balance || 0), 0);
      subtitle = `Applied Filters: ${filterParts.join(' | ') || 'None'} | Totals: ${rows.length} Suppliers, Payable: ₹${totalBal.toFixed(2)}`;
    } else {
      return error(res, 'Unknown export type', 404);
    }

    saveReportPdf({ name: `${type}-${Date.now()}`, title, subtitle, data: { rows } })
      .then((file) => success(res, { fileName: file.fileName, folder: config.exportDir }, 'PDF saved to system exports folder'))
      .catch((err) => error(res, err.message, 500));
  } catch (err) { return error(res, err.message, 500); }
}

function listExports(req, res) {
  try {
    const dir = path.resolve(config.exportDir);
    if (!fs.existsSync(dir)) return success(res, []);
    const files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.pdf')).map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, created_at: stat.mtime.toISOString() };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return success(res, files);
  } catch (err) { return error(res, err.message, 500); }
}

function listBackups(req, res) {
  try {
    const backupDir = path.resolve(config.backupDir);
    if (!fs.existsSync(backupDir)) return success(res, []);
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db') || f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(backupDir, f));
        return { name: f, size: stat.size, created_at: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return success(res, files);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function restore(req, res) {
  try {
    const { filename } = req.body;
    if (!filename) return error(res, 'Filename required', 400, null, 'ERR_REQUIRED');

    // basename() keeps the lookup inside the backup directory.
    const safeName = path.basename(String(filename));
    if (!safeName.endsWith('.db')) {
      return error(res, 'Only .db backups can be restored directly', 400, null, 'ERR_BACKUP_FORMAT');
    }
    const backupPath = path.join(path.resolve(config.backupDir), safeName);
    if (!fs.existsSync(backupPath)) {
      return error(res, 'Backup file not found', 404, null, 'ERR_NOT_FOUND');
    }

    const dbPath = path.resolve(config.dbPath);

    // Snapshot the current database so a bad restore can be undone.
    const rollbackPath = `${dbPath}.pre-restore`;
    try {
      db.persist();
      if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, rollbackPath);
    } catch {
      /* best effort */
    }

    fs.copyFileSync(backupPath, dbPath);

    try {
      // Swap the in-memory image to the restored file so the running server
      // keeps serving requests — no manual restart needed.
      db.reload();
    } catch (reloadErr) {
      // Restore failed to load: put the previous database back.
      try {
        if (fs.existsSync(rollbackPath)) {
          fs.copyFileSync(rollbackPath, dbPath);
          db.reload();
        }
      } catch {
        /* ignore */
      }
      return error(res, `Restore failed: ${reloadErr.message}`, 500, null, 'ERR_RESTORE_FAILED');
    }

    try {
      if (fs.existsSync(rollbackPath)) fs.unlinkSync(rollbackPath);
    } catch {
      /* ignore */
    }

    return success(res, { restored: safeName }, 'Database restored');
  } catch (err) {
    return error(res, err.message, 500, null, err.code);
  }
}

function exportData(req, res) {
  try {
    const { format = 'json', type = 'products' } = req.query;
    const allowed = {
      products: 'SELECT p.*, c.name as category, b.name as brand FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id WHERE p.is_active=1',
      customers: 'SELECT * FROM customers WHERE is_active=1',
      suppliers: 'SELECT * FROM suppliers WHERE is_active=1',
      sales: "SELECT * FROM sales WHERE status!='cancelled'",
      purchases: "SELECT * FROM purchases WHERE status!='cancelled'",
      expenses: 'SELECT * FROM expenses',
    };

    if (!allowed[type]) return error(res, 'Invalid export type');
    const rows = db.prepare(allowed[type]).all();

    if (format === 'csv') {
      const { stringify } = require('csv-stringify/sync');
      if (!rows.length) return error(res, 'No data to export');
      // Neutralise leading =, +, -, @ so spreadsheets do not execute exported
      // values as formulas.
      const csv = stringify(csvSafeRows(rows), { header: true });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-export.csv"`);
      return res.send(csv);
    }

    if (format === 'xlsx') {
      const buf = xlsxUtil.writeSheet(csvSafeRows(rows), type);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-export.xlsx"`);
      return res.send(buf);
    }

    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function importData(req, res) {
  try {
    if (!req.file) return error(res, 'No file uploaded');
    const { type = 'products' } = req.body;
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let rows = [];
    if (ext === '.csv') {
      const { parse } = require('csv-parse/sync');
      const content = fs.readFileSync(filePath, 'utf8');
      rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    } else if (ext === '.xlsx') {
      rows = xlsxUtil.readSheet(fs.readFileSync(filePath));
    } else {
      return error(res, 'Unsupported file format. Use CSV or XLSX.', 400, null, 'ERR_FILE_FORMAT');
    }

    let imported = 0;
    const txn = db.transaction(() => {
      for (const row of rows) {
        if (type === 'products' && row.name) {
          const exists = row.sku ? db.prepare('SELECT id FROM products WHERE sku = ?').get(row.sku) : null;
          if (!exists) {
            db.prepare(`
              INSERT INTO products (name, sku, barcode, purchase_price, selling_price, mrp, tax_rate, min_stock, opening_stock, current_stock, hsn_code)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)
            `).run(
              row.name, row.sku || null, row.barcode || null,
              Number(row.purchase_price) || 0, Number(row.selling_price) || 0, Number(row.mrp) || 0,
              Number(row.tax_rate) || 0, Number(row.min_stock) || 0,
              Number(row.opening_stock || row.current_stock) || 0,
              Number(row.opening_stock || row.current_stock) || 0,
              row.hsn_code || null
            );
            imported++;
          }
        } else if (type === 'customers' && row.name) {
          db.prepare('INSERT INTO customers (name, phone, email, address, city, state, gstin) VALUES (?,?,?,?,?,?,?)')
            .run(row.name, row.phone || null, row.email || null, row.address || null, row.city || null, row.state || null, row.gstin || null);
          imported++;
        } else if (type === 'suppliers' && row.name) {
          db.prepare('INSERT INTO suppliers (name, phone, email, address, city, state, gstin) VALUES (?,?,?,?,?,?,?)')
            .run(row.name, row.phone || null, row.email || null, row.address || null, row.city || null, row.state || null, row.gstin || null);
          imported++;
        }
      }
    });
    txn();

    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    return success(res, { imported, total_rows: rows.length }, `Imported ${imported} records`);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = {
  getSettings, updateSettings, uploadLogo, uploadSignature, deleteSignature, exportPdf, listExports,
  listTaxRates, createTaxRate, deleteTaxRate,
  backup, listBackups, restore, exportData, importData,
};
