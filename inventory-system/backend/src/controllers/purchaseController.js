const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { now, today, calcLineTotal, calcInvoiceTotals, round2, sanitizeLike } = require('../utils/helpers');
const numberService = require('../services/numberService');
const stockService = require('../services/stockService');
const partyService = require('../services/partyService');

function list(req, res) {
  try {
    const { page = 1, limit = 20, search, type, status, payment_status, supplier_id, from_date, to_date } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (type) { where += ' AND p.bill_type = ?'; params.push(type); }
    else { where += " AND p.bill_type = 'purchase'"; }
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (payment_status) { where += ' AND p.payment_status = ?'; params.push(payment_status); }
    if (supplier_id) { where += ' AND p.supplier_id = ?'; params.push(supplier_id); }
    if (from_date) { where += ' AND p.bill_date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND p.bill_date <= ?'; params.push(to_date); }
    if (search) {
      where += ' AND (p.bill_number LIKE ? OR s.name LIKE ? OR p.supplier_invoice LIKE ?)';
      const q = `%${sanitizeLike(search)}%`;
      params.push(q, q, q);
    }

    const total = db.prepare(`
      SELECT COUNT(*) as c FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ${where}
    `).get(...params).c;

    const lim = Math.min(100, +limit || 20);
    const offset = (Math.max(1, +page) - 1) * lim;

    const rows = db.prepare(`
      SELECT p.*, s.name as supplier_name, s.phone as supplier_phone, u.full_name as created_by_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN users u ON u.id = p.created_by
      ${where}
      ORDER BY p.bill_date DESC, p.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, lim, offset);

    return paginated(res, rows, total, +page || 1, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getById(req, res) {
  try {
    const purchase = db.prepare(`
      SELECT p.*, s.name as supplier_name, s.phone as supplier_phone, s.email as supplier_email,
        s.address as supplier_address, s.gstin as supplier_gstin, w.name as warehouse_name,
        u.full_name as created_by_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN warehouses w ON w.id = p.warehouse_id
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.id = ?
    `).get(req.params.id);
    if (!purchase) return error(res, 'Purchase not found', 404);

    purchase.items = db.prepare(`
      SELECT pi.*, pr.sku, pr.barcode, un.short_name as unit_name
      FROM purchase_items pi
      LEFT JOIN products pr ON pr.id = pi.product_id
      LEFT JOIN units un ON un.id = pi.unit_id
      WHERE pi.purchase_id = ?
    `).all(purchase.id);

    purchase.payments = db.prepare('SELECT * FROM payments WHERE purchase_id = ? ORDER BY payment_date').all(purchase.id);
    return success(res, purchase);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function create(req, res) {
  const createTxn = db.transaction(() => {
    const {
      bill_type = 'purchase', supplier_id, bill_date, due_date, reference_number, supplier_invoice,
      items = [], discount_type = 'amount', discount_value = 0,
      shipping_charges = 0, other_charges = 0, round_off = 0,
      notes, warehouse_id, paid_amount = 0, payment_mode = 'cash',
      bank_account_id, status = 'completed',
    } = req.body;

    if (!items.length) throw new Error('At least one item is required');

    const billNumber = numberService.nextNumber(bill_type);
    const date = bill_date || today();
    const wh = warehouse_id || stockService.getDefaultWarehouse()?.id;

    const processedItems = items.map((item) => {
      const calc = calcLineTotal(item.quantity, item.unit_price, item.discount_type || 'amount', item.discount_value || 0, item.tax_rate || 0);
      return {
        product_id: item.product_id || null,
        product_name: item.product_name || item.name,
        hsn_code: item.hsn_code || null,
        batch_number: item.batch_number || null,
        expiry_date: item.expiry_date || null,
        quantity: Number(item.quantity) || 1,
        unit_id: item.unit_id || null,
        unit_price: Number(item.unit_price) || 0,
        discount_type: item.discount_type || 'amount',
        discount_value: Number(item.discount_value) || 0,
        discount_amount: calc.discountAmount,
        tax_rate: Number(item.tax_rate) || 0,
        tax_amount: calc.taxAmount,
        total: calc.total,
      };
    });

    const totals = calcInvoiceTotals(processedItems, discount_type, discount_value, shipping_charges, other_charges, round_off);
    const paid = Number(paid_amount) || 0;
    const balance = round2(totals.grandTotal - paid);
    let paymentStatus = 'unpaid';
    if (paid >= totals.grandTotal) paymentStatus = 'paid';
    else if (paid > 0) paymentStatus = 'partial';

    const result = db.prepare(`
      INSERT INTO purchases (
        bill_number, bill_type, supplier_id, bill_date, due_date, reference_number, supplier_invoice,
        status, payment_status, subtotal, discount_type, discount_value, discount_amount,
        tax_amount, shipping_charges, other_charges, round_off, grand_total, paid_amount,
        balance_amount, notes, warehouse_id, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      billNumber, bill_type, supplier_id || null, date, due_date || null, reference_number || null, supplier_invoice || null,
      status, paymentStatus, totals.subtotal, discount_type, Number(discount_value) || 0, totals.discountAmount,
      totals.taxAmount, Number(shipping_charges) || 0, Number(other_charges) || 0, Number(round_off) || 0,
      totals.grandTotal, paid, balance, notes || null, wh || null, req.user.id
    );

    const purchaseId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO purchase_items (purchase_id, product_id, product_name, hsn_code, batch_number, expiry_date, quantity, unit_id, unit_price, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const item of processedItems) {
      insertItem.run(purchaseId, item.product_id, item.product_name, item.hsn_code, item.batch_number, item.expiry_date, item.quantity, item.unit_id, item.unit_price, item.discount_type, item.discount_value, item.discount_amount, item.tax_rate, item.tax_amount, item.total);

      if (status === 'completed' && item.product_id) {
        const prod = db.prepare('SELECT is_service, has_batch FROM products WHERE id = ?').get(item.product_id);
        if (prod && !prod.is_service) {
          if (bill_type === 'purchase') {
            stockService.increaseStock(item.product_id, item.quantity, wh);
            if (item.batch_number) {
              const existingBatch = db.prepare('SELECT id, quantity FROM product_batches WHERE product_id = ? AND batch_number = ?').get(item.product_id, item.batch_number);
              if (existingBatch) {
                db.prepare('UPDATE product_batches SET quantity = quantity + ? WHERE id = ?').run(item.quantity, existingBatch.id);
              } else {
                db.prepare(`
                  INSERT INTO product_batches (product_id, warehouse_id, batch_number, expiry_date, quantity, purchase_price)
                  VALUES (?,?,?,?,?,?)
                `).run(item.product_id, wh, item.batch_number, item.expiry_date, item.quantity, item.unit_price);
              }
            }
            // Update purchase price
            db.prepare('UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?').run(item.unit_price, now(), item.product_id);
          } else if (bill_type === 'purchase_return') {
            stockService.reduceStock(item.product_id, item.quantity, wh);
          }
        }
      }
    }

    if (paid > 0 && status === 'completed') {
      const payNum = numberService.nextNumber('payment_out');
      db.prepare(`
        INSERT INTO payments (payment_number, payment_type, party_type, party_id, payment_date, amount, payment_mode, bank_account_id, purchase_id, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(payNum, 'payment_out', 'supplier', supplier_id || null, date, paid, payment_mode, bank_account_id || null, purchaseId, req.user.id);

      if (bank_account_id) {
        partyService.updateBankBalance(bank_account_id, paid, 'debit');
      } else {
        const cashAcc = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get();
        if (cashAcc) partyService.updateBankBalance(cashAcc.id, paid, 'debit');
      }
    }

    if (supplier_id) partyService.updateSupplierBalance(supplier_id);
    return db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
  });

  try {
    const purchase = createTxn();
    const full = db.prepare(`
      SELECT p.*, s.name as supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?
    `).get(purchase.id);
    full.items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchase.id);
    return success(res, full, 'Purchase created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function cancel(req, res) {
  const txn = db.transaction(() => {
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    if (!purchase) throw new Error('Purchase not found');
    if (purchase.status === 'cancelled') throw new Error('Already cancelled');

    if (purchase.status === 'completed') {
      const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchase.id);
      for (const item of items) {
        if (!item.product_id) continue;
        const prod = db.prepare('SELECT is_service FROM products WHERE id = ?').get(item.product_id);
        if (prod && prod.is_service) continue;
        if (purchase.bill_type === 'purchase') {
          stockService.reduceStock(item.product_id, item.quantity, purchase.warehouse_id);
        } else if (purchase.bill_type === 'purchase_return') {
          stockService.increaseStock(item.product_id, item.quantity, purchase.warehouse_id);
        }
      }
    }

    db.prepare("UPDATE purchases SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), purchase.id);
    if (purchase.supplier_id) partyService.updateSupplierBalance(purchase.supplier_id);
    return purchase;
  });

  try {
    txn();
    return success(res, null, 'Purchase cancelled');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, getById, create, cancel };
