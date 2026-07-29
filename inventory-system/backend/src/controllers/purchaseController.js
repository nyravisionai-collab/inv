const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { now, today, calcLineTotal, calcInvoiceTotals, round2, sanitizeLike } = require('../utils/helpers');
const numberService = require('../services/numberService');
const stockService = require('../services/stockService');
const partyService = require('../services/partyService');
const productService = require('../services/productService');
const paymentService = require('../services/paymentService');
const {
  requireArray, validateLineItem, validateDocumentTotals,
  oneOf, optionalDate, pageParams,
} = require('../utils/validate');

const PURCHASE_TYPES = ['purchase', 'purchase_order', 'purchase_return'];
const PURCHASE_STATUSES = ['draft', 'pending', 'completed', 'cancelled', 'converted'];

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
      where += ' AND (p.bill_number LIKE ? ESCAPE \'!\' OR s.name LIKE ? ESCAPE \'!\' OR p.supplier_invoice LIKE ? ESCAPE \'!\')';
      const q = `%${sanitizeLike(search)}%`;
      params.push(q, q, q);
    }

    const total = db.prepare(`
      SELECT COUNT(*) as c FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ${where}
    `).get(...params).c;

    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });

    const rows = db.prepare(`
      SELECT p.*, s.name as supplier_name, s.phone as supplier_phone, u.full_name as created_by_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN users u ON u.id = p.created_by
      ${where}
      ORDER BY p.bill_date DESC, p.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, lim, offset);

    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
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
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

function create(req, res) {
  const createTxn = db.transaction(() => {
    const { supplier_id, reference_number, supplier_invoice, notes, warehouse_id,
      payment_mode = 'cash', bank_account_id } = req.body;

    const bill_type = oneOf(req.body.bill_type, PURCHASE_TYPES, 'Bill type', 'purchase');
    const status = oneOf(req.body.status, PURCHASE_STATUSES, 'Status', 'completed');
    const items = requireArray(req.body.items, 'Items');
    const money = validateDocumentTotals(req.body);
    const date = optionalDate(req.body.bill_date, 'Bill date') || today();
    const due_date = optionalDate(req.body.due_date, 'Due date');

    const wh = warehouse_id || stockService.getDefaultWarehouse()?.id;

    const processedItems = items.map((item, index) => {
      if (item.tax_type === undefined && item.product_id) {
        const prodTax = db.prepare('SELECT tax_type FROM products WHERE id = ?').get(item.product_id);
        if (prodTax && prodTax.tax_type) item = { ...item, tax_type: prodTax.tax_type };
      }
      const v = validateLineItem(item, index);
      const calc = calcLineTotal(v.quantity, v.unitPrice, v.discountType, v.discountValue, v.taxRate, v.taxType);

      // A bill may name an item that is not in the catalogue yet. Match it by
      // name and, when it is genuinely new, create the product so the stock
      // movement and the purchase price are not lost.
      let productId = item.product_id || null;
      if (!productId && bill_type !== 'purchase_return') {
        const linked = productService.findOrCreateByName({
          ...item,
          unit_price: v.unitPrice,
          tax_rate: v.taxRate,
          tax_type: v.taxType,
        });
        if (linked) productId = linked.id;
      } else if (!productId) {
        const linked = productService.findByName(item.product_name || item.name);
        if (linked) productId = linked.id;
      }

      const productBefore = productId ? db.prepare('SELECT purchase_price, selling_price, mrp FROM products WHERE id = ?').get(productId) : null;
      const batchId = (bill_type === 'purchase_return' && productId && item.batch_number)
        ? db.prepare('SELECT id FROM product_batches WHERE product_id = ? AND batch_number = ?').get(productId, item.batch_number)?.id || null
        : null;

      return {
        product_id: productId,
        product_name: item.product_name || item.name,
        mrp: item.mrp !== undefined ? Number(item.mrp) || 0 : 0,
        selling_price: item.selling_price !== undefined ? Number(item.selling_price) || 0 : 0,
        hsn_code: item.hsn_code || null,
        batch_number: item.batch_number || null,
        batch_id: batchId,
        expiry_date: optionalDate(item.expiry_date, `Item ${index + 1} expiry date`),
        quantity: v.quantity,
        unit_id: item.unit_id || null,
        unit_price: v.unitPrice,
        discount_type: v.discountType,
        discount_value: v.discountValue,
        line_discount_amount: calc.discountAmount,
        discount_amount: calc.discountAmount,
        invoice_discount_amount: 0,
        tax_rate: v.taxRate,
        tax_type: v.taxType,
        taxable_amount: calc.taxableAmount,
        tax_amount: calc.taxAmount,
        total: calc.total,
        prev_purchase_price: productBefore ? Number(productBefore.purchase_price) || 0 : null,
        prev_selling_price: productBefore ? Number(productBefore.selling_price) || 0 : null,
        prev_mrp: productBefore ? Number(productBefore.mrp) || 0 : null,
      };
    });

    // A purchase return moves goods back out of stock, so it needs the same
    // availability guard that sales use.
    if (status === 'completed' && bill_type === 'purchase_return') {
      stockService.assertItemsAvailable(processedItems, wh);
    }

    const billNumber = numberService.nextNumber(bill_type);

    const totals = calcInvoiceTotals(processedItems, money.discountType, money.discountValue,
      money.shippingCharges, money.otherCharges, money.roundOff);
    const paid = money.paidAmount;
    if (paid > totals.grandTotal + 0.009) {
      const err = new Error('Paid amount cannot exceed the grand total');
      err.status = 400;
      err.code = 'ERR_PAYMENT_RANGE';
      throw err;
    }
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
      billNumber, bill_type, supplier_id || null, date, due_date, reference_number || null, supplier_invoice || null,
      status, paymentStatus, totals.subtotal, money.discountType, money.discountValue, totals.discountAmount,
      totals.taxAmount, money.shippingCharges, money.otherCharges, money.roundOff,
      totals.grandTotal, paid, balance, notes || null, wh || null, req.user.id
    );

    const purchaseId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, product_name, hsn_code, batch_number, expiry_date,
        quantity, unit_id, unit_price, discount_type, discount_value, discount_amount,
        invoice_discount_amount, tax_rate, tax_type, taxable_amount, tax_amount, total,
        prev_purchase_price, prev_selling_price, prev_mrp
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const item of processedItems) {
      insertItem.run(
        purchaseId, item.product_id, item.product_name, item.hsn_code, item.batch_number, item.expiry_date,
        item.quantity, item.unit_id, item.unit_price, item.discount_type, item.discount_value, item.discount_amount,
        item.invoice_discount_amount, item.tax_rate, item.tax_type, item.taxable_amount, item.tax_amount, item.total,
        item.prev_purchase_price, item.prev_selling_price, item.prev_mrp
      );

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
          } else if (bill_type === 'purchase_return') {
            stockService.reduceStock(item.product_id, item.quantity, wh, item.batch_id);
          }
        }
        // The rate actually paid becomes the product's purchase price (plus
        // MRP / selling price when the bill carries them) so stock valuation,
        // margins and the next bill all start from the latest cost.
        if (bill_type === 'purchase') {
          productService.applyPurchasePricing(item.product_id, item);
        }
      }
    }

    if (paid > 0 && status === 'completed') {
      const isReturn = bill_type === 'purchase_return';
      const paymentType = isReturn ? 'payment_in' : 'payment_out';
      const payNum = numberService.nextNumber(paymentType);
      let baId = bank_account_id || null;
      if (!baId) {
        const cashAcc = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get();
        baId = cashAcc?.id || null;
      }
      const payRes = db.prepare(`
        INSERT INTO payments (payment_number, payment_type, party_type, party_id, payment_date, amount, payment_mode, bank_account_id, purchase_id, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(payNum, paymentType, 'supplier', supplier_id || null, date, paid, payment_mode, baId, purchaseId, req.user.id);

      // Already reflected in the bill's paid_amount — record the allocation so
      // supplier balance and payment deletion do not double count it.
      db.prepare('INSERT INTO payment_allocations (payment_id, purchase_id, amount) VALUES (?,?,?)')
        .run(payRes.lastInsertRowid, purchaseId, paid);

      if (baId) partyService.updateBankBalance(baId, paid, isReturn ? 'credit' : 'debit');
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
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

function cancel(req, res) {
  const txn = db.transaction(() => {
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    if (!purchase) throw Object.assign(new Error('Purchase not found'), { status: 404, code: 'ERR_NOT_FOUND' });
    if (purchase.status === 'cancelled') throw Object.assign(new Error('Already cancelled'), { status: 400, code: 'ERR_ALREADY_CANCELLED' });

    const priceFallbacks = new Map();
    if (purchase.status === 'completed') {
      const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchase.id);
      for (const item of items) {
        if (!item.product_id) continue;
        if (!priceFallbacks.has(item.product_id)) {
          priceFallbacks.set(item.product_id, {
            prev_purchase_price: item.prev_purchase_price,
            prev_selling_price: item.prev_selling_price,
            prev_mrp: item.prev_mrp,
          });
        }
        const prod = db.prepare('SELECT is_service FROM products WHERE id = ?').get(item.product_id);
        if (prod && prod.is_service) continue;
        const batchId = item.batch_number
          ? db.prepare('SELECT id FROM product_batches WHERE product_id = ? AND batch_number = ?').get(item.product_id, item.batch_number)?.id || null
          : null;
        if (purchase.bill_type === 'purchase') {
          stockService.reduceStock(item.product_id, item.quantity, purchase.warehouse_id, batchId);
        } else if (purchase.bill_type === 'purchase_return') {
          stockService.increaseStock(item.product_id, item.quantity, purchase.warehouse_id, batchId);
        }
      }
    }

    db.prepare("UPDATE purchases SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), purchase.id);
    if (purchase.bill_type === 'purchase') {
      for (const [productId, fallback] of priceFallbacks.entries()) {
        productService.recomputePurchasePricing(productId, fallback);
      }
    }
    // Same as sales: a cancelled bill releases whatever was paid against it.
    paymentService.releaseDocument('payment_out', purchase.id);
    if (purchase.supplier_id) partyService.updateSupplierBalance(purchase.supplier_id);
    return purchase;
  });

  try {
    txn();
    return success(res, null, 'Purchase cancelled');
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

module.exports = { list, getById, create, cancel };

/** Purchase bills, purchase orders and purchase returns are stored as PDFs too. */
function pdfDocument(req, res) {
  try {
    const purchase = db.prepare(`SELECT p.*, s.name supplier_name, s.address supplier_address, s.gstin supplier_gstin
      FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?`).get(req.params.id);
    if (!purchase) return error(res, 'Purchase not found', 404);
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id=?').all(purchase.id);
    const company = db.prepare('SELECT * FROM company_settings WHERE id=1').get() || {};
    const { createPdfDocument, pdfMoney } = require('../utils/pdf');
    const { mirrorDocumentPdf } = require('../utils/exportPdf');
    const { doc, writeText, setBold, unicode } = createPdfDocument();
    const money = (n) => pdfMoney(n, company.currency_symbol || '₹', unicode);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${purchase.bill_number}.pdf"`);
    doc.pipe(res); mirrorDocumentPdf(doc, purchase.bill_number);
    setBold(true); doc.fontSize(18); writeText(company.company_name || 'Inventory System');
    doc.fontSize(16); writeText(purchase.bill_type === 'purchase_return' ? 'PURCHASE RETURN' : purchase.bill_type === 'purchase_order' ? 'PURCHASE ORDER' : 'PURCHASE BILL', { align: 'right' });
    setBold(false); doc.fontSize(10); writeText(`No: ${purchase.bill_number}`, { align: 'right' }); writeText(`Date: ${purchase.bill_date}`, { align: 'right' });
    doc.moveDown(); setBold(true); writeText('Supplier:'); setBold(false); writeText(purchase.supplier_name || '—');
    if (purchase.supplier_address) writeText(purchase.supplier_address); if (purchase.supplier_gstin) writeText(`GSTIN: ${purchase.supplier_gstin}`);
    doc.moveDown(); let y = doc.y; setBold(true); ['#', 'Item', 'Qty', 'Rate', 'Tax', 'Total'].forEach((h, i) => writeText(h, { x: [50, 80, 270, 325, 390, 450][i], y, width: [25, 180, 50, 60, 55, 85][i], align: i === 5 ? 'right' : 'left' }));
    setBold(false); y += 20;
    items.forEach((item, i) => { if (y > 720) { doc.addPage(); y = 50; } writeText(String(i + 1), { x: 50, y, width: 25 }); writeText(item.product_name, { x: 80, y, width: 180 }); writeText(String(item.quantity), { x: 270, y, width: 50 }); writeText(Number(item.unit_price).toFixed(2), { x: 325, y, width: 60 }); writeText(Number(item.tax_amount).toFixed(2), { x: 390, y, width: 55 }); writeText(Number(item.total).toFixed(2), { x: 450, y, width: 85, align: 'right' }); y += 18; });
    y += 10; setBold(true); doc.fontSize(12); writeText(`Grand Total: ${money(purchase.grand_total)}`, { x: 320, y, width: 215, align: 'right' }); setBold(false);
    if (purchase.notes) { y += 28; doc.fontSize(10); writeText(`Notes: ${purchase.notes}`, { x: 50, y, width: 480 }); }
    doc.end();
  } catch (err) { if (!res.headersSent) return error(res, err.message, 500); res.end(); }
}
module.exports.pdfDocument = pdfDocument;
