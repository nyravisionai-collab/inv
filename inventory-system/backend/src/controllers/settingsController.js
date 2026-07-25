const db = require('../db/database');
const fs = require('fs');
const path = require('path');
const { success, error } = require('../utils/response');
const { now } = require('../utils/helpers');
const config = require('../config');

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
    if (!filename) return error(res, 'Filename required');
    const backupPath = path.join(path.resolve(config.backupDir), path.basename(filename));
    if (!fs.existsSync(backupPath)) return error(res, 'Backup file not found', 404);
    if (!filename.endsWith('.db')) return error(res, 'Only .db backups can be restored directly');

    const dbPath = path.resolve(config.dbPath);
    try {
      db.persist();
      db.close();
    } catch {
      /* ignore */
    }
    fs.copyFileSync(backupPath, dbPath);

    // Re-init sql.js from restored file
    try {
      // Reset module state by re-requiring is unsafe; tell user to restart
    } catch {
      /* ignore */
    }
    return success(res, null, 'Database restored. Please restart the server.');
  } catch (err) {
    return error(res, err.message, 500);
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
      const csv = stringify(rows, { header: true });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-export.csv"`);
      return res.send(csv);
    }

    if (format === 'xlsx') {
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, type);
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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
    } else if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet);
    } else {
      return error(res, 'Unsupported file format. Use CSV or Excel.');
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
  getSettings, updateSettings, uploadLogo,
  listTaxRates, createTaxRate, deleteTaxRate,
  backup, listBackups, restore, exportData, importData,
};
