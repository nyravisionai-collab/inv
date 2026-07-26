const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { now, today, calcLineTotal, calcInvoiceTotals, round2, sanitizeLike } = require('../utils/helpers');
const numberService = require('../services/numberService');
const stockService = require('../services/stockService');
const partyService = require('../services/partyService');
const {
  requireArray, validateLineItem, validateDocumentTotals,
  oneOf, optionalDate, pageParams,
} = require('../utils/validate');
const { createPdfDocument, pdfMoney } = require('../utils/pdf');

const SALE_TYPES = ['sale', 'estimate', 'sale_order', 'delivery_challan', 'sale_return', 'pos'];
const SALE_STATUSES = ['draft', 'pending', 'completed', 'cancelled', 'converted'];

function list(req, res) {
  try {
    const { page = 1, limit = 20, search, type, status, payment_status, customer_id, from_date, to_date } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (type) { where += ' AND s.invoice_type = ?'; params.push(type); }
    else { where += " AND s.invoice_type IN ('sale','pos')"; }
    if (status) { where += ' AND s.status = ?'; params.push(status); }
    if (payment_status) { where += ' AND s.payment_status = ?'; params.push(payment_status); }
    if (customer_id) { where += ' AND s.customer_id = ?'; params.push(customer_id); }
    if (from_date) { where += ' AND s.invoice_date >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND s.invoice_date <= ?'; params.push(to_date); }
    if (search) {
      where += " AND (s.invoice_number LIKE ? ESCAPE '!' OR c.name LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!')";
      const s = `%${sanitizeLike(search)}%`;
      params.push(s, s, s);
    }

    const total = db.prepare(`
      SELECT COUNT(*) as c FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${where}
    `).get(...params).c;

    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });

    const rows = db.prepare(`
      SELECT s.*, c.name as customer_name, c.phone as customer_phone,
        u.full_name as created_by_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.created_by
      ${where}
      ORDER BY s.invoice_date DESC, s.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, lim, offset);

    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getById(req, res) {
  try {
    const sale = db.prepare(`
      SELECT s.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
        c.address as customer_address, c.gstin as customer_gstin, c.city as customer_city,
        c.state as customer_state, w.name as warehouse_name, u.full_name as created_by_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      LEFT JOIN users u ON u.id = s.created_by
      WHERE s.id = ?
    `).get(req.params.id);
    if (!sale) return error(res, 'Sale not found', 404, null, 'ERR_NOT_FOUND');

    sale.items = db.prepare(`
      SELECT si.*, p.sku, p.barcode, un.short_name as unit_name
      FROM sale_items si
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN units un ON un.id = si.unit_id
      WHERE si.sale_id = ?
    `).all(sale.id);

    sale.payments = db.prepare('SELECT * FROM payments WHERE sale_id = ? ORDER BY payment_date').all(sale.id);

    return success(res, sale);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

/**
 * Core sale-creation logic, free of HTTP concerns.
 *
 * Callers are responsible for wrapping this in a transaction, which lets
 * `convert()` mark the source document and create the target document
 * atomically instead of leaving a half-converted record behind.
 */
function createSaleCore(body, userId) {
  const invoiceType = oneOf(body.invoice_type, SALE_TYPES, 'Invoice type', 'sale');
  const status = oneOf(body.status, SALE_STATUSES, 'Status', 'completed');
  const items = requireArray(body.items, 'Items');
  const money = validateDocumentTotals(body);
  const date = optionalDate(body.invoice_date, 'Invoice date') || today();
  const dueDate = optionalDate(body.due_date, 'Due date');

  const wh = body.warehouse_id || stockService.getDefaultWarehouse()?.id;

  const processedItems = items.map((item, index) => {
    // Inherit the product's configured tax mode when the client didn't specify
    // one, so MRP-inclusive products are priced correctly from POS too.
    if (item.tax_type === undefined && item.product_id) {
      const prodTax = db.prepare('SELECT tax_type FROM products WHERE id = ?').get(item.product_id);
      if (prodTax && prodTax.tax_type) item = { ...item, tax_type: prodTax.tax_type };
    }
    const v = validateLineItem(item, index);
    const calc = calcLineTotal(v.quantity, v.unitPrice, v.discountType, v.discountValue, v.taxRate, v.taxType);
    // Snapshot the cost at the time of sale so historical profit reports stay
    // stable even when the product's purchase price changes later.
    const costRow = item.product_id
      ? db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(item.product_id)
      : null;
    return {
      product_id: item.product_id || null,
      product_name: item.product_name || item.name,
      hsn_code: item.hsn_code || null,
      batch_id: item.batch_id || null,
      quantity: v.quantity,
      unit_id: item.unit_id || null,
      unit_price: v.unitPrice,
      cost_price: costRow ? Number(costRow.purchase_price) || 0 : 0,
      discount_type: v.discountType,
      discount_value: v.discountValue,
      discount_amount: calc.discountAmount,
      tax_rate: v.taxRate,
      tax_amount: calc.taxAmount,
      total: calc.total,
    };
  });

  // Reject the whole document up-front if stock is insufficient, so we never
  // write a sale that drives inventory negative.
  const reducesStock = status === 'completed' && ['sale', 'pos'].includes(invoiceType);
  if (reducesStock) {
    stockService.assertItemsAvailable(processedItems, wh);
  }

  const totals = calcInvoiceTotals(
    processedItems, money.discountType, money.discountValue,
    money.shippingCharges, money.otherCharges, money.roundOff
  );
  const paid = money.paidAmount;
  const balance = round2(totals.grandTotal - paid);
  let paymentStatus = 'unpaid';
  if (paid >= totals.grandTotal) paymentStatus = 'paid';
  else if (paid > 0) paymentStatus = 'partial';

  const invoiceNumber = numberService.nextNumber(invoiceType);

  const result = db.prepare(`
    INSERT INTO sales (
      invoice_number, invoice_type, customer_id, invoice_date, due_date, reference_number,
      status, payment_status, subtotal, discount_type, discount_value, discount_amount,
      tax_amount, shipping_charges, other_charges, round_off, grand_total, paid_amount,
      balance_amount, notes, terms, warehouse_id, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    invoiceNumber, invoiceType, body.customer_id || null, date, dueDate, body.reference_number || null,
    status, paymentStatus, totals.subtotal, money.discountType, money.discountValue, totals.discountAmount,
    totals.taxAmount, money.shippingCharges, money.otherCharges, money.roundOff,
    totals.grandTotal, paid, balance, body.notes || null, body.terms || null, wh || null, userId
  );

  const saleId = result.lastInsertRowid;
  const insertItem = db.prepare(`
    INSERT INTO sale_items (sale_id, product_id, product_name, hsn_code, batch_id, quantity, unit_id, unit_price, cost_price, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  for (const item of processedItems) {
    insertItem.run(
      saleId, item.product_id, item.product_name, item.hsn_code, item.batch_id,
      item.quantity, item.unit_id, item.unit_price, item.cost_price, item.discount_type,
      item.discount_value, item.discount_amount, item.tax_rate, item.tax_amount, item.total
    );

    if (status === 'completed' && item.product_id) {
      const prod = db.prepare('SELECT is_service FROM products WHERE id = ?').get(item.product_id);
      if (prod && !prod.is_service) {
        if (['sale', 'pos'].includes(invoiceType)) {
          stockService.reduceStock(item.product_id, item.quantity, wh);
        } else if (invoiceType === 'sale_return') {
          stockService.increaseStock(item.product_id, item.quantity, wh);
        }
      }
    }
  }

  // Record payment if paid
  if (paid > 0 && status === 'completed') {
    const payNum = numberService.nextNumber('payment_in');
    const paymentMode = body.payment_mode || 'cash';
    db.prepare(`
      INSERT INTO payments (payment_number, payment_type, party_type, party_id, payment_date, amount, payment_mode, bank_account_id, sale_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(payNum, 'payment_in', 'customer', body.customer_id || null, date, paid, paymentMode, body.bank_account_id || null, saleId, userId);

    if (body.bank_account_id) {
      partyService.updateBankBalance(body.bank_account_id, paid, 'credit');
    } else {
      const cashAcc = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get();
      if (cashAcc) partyService.updateBankBalance(cashAcc.id, paid, 'credit');
    }
  }

  if (body.customer_id) partyService.updateCustomerBalance(body.customer_id);

  return saleId;
}

function loadFullSale(saleId) {
  const full = db.prepare(`
    SELECT s.*, c.name as customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?
  `).get(saleId);
  full.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
  return full;
}

function create(req, res) {
  try {
    const saleId = db.transaction(() => createSaleCore(req.body, req.user.id))();
    return success(res, loadFullSale(saleId), 'Sale created', 201);
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

function update(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Sale not found', 404, null, 'ERR_NOT_FOUND');
    if (existing.status === 'cancelled') return error(res, 'Cannot update cancelled sale', 400, null, 'ERR_CANCELLED');

    const b = req.body;
    db.prepare(`
      UPDATE sales SET notes=?, terms=?, due_date=?, reference_number=?, updated_at=? WHERE id=?
    `).run(
      b.notes !== undefined ? b.notes : existing.notes,
      b.terms !== undefined ? b.terms : existing.terms,
      b.due_date !== undefined ? b.due_date : existing.due_date,
      b.reference_number !== undefined ? b.reference_number : existing.reference_number,
      now(), req.params.id
    );

    return success(res, db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id), 'Sale updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function cancel(req, res) {
  const txn = db.transaction(() => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!sale) throw Object.assign(new Error('Sale not found'), { status: 404, code: 'ERR_NOT_FOUND' });
    if (sale.status === 'cancelled') throw Object.assign(new Error('Already cancelled'), { status: 400, code: 'ERR_ALREADY_CANCELLED' });

    // Reverse stock
    if (sale.status === 'completed') {
      const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
      for (const item of items) {
        if (!item.product_id) continue;
        const prod = db.prepare('SELECT is_service FROM products WHERE id = ?').get(item.product_id);
        if (prod && prod.is_service) continue;
        if (['sale', 'pos'].includes(sale.invoice_type)) {
          stockService.increaseStock(item.product_id, item.quantity, sale.warehouse_id);
        } else if (sale.invoice_type === 'sale_return') {
          stockService.reduceStock(item.product_id, item.quantity, sale.warehouse_id);
        }
      }
    }

    db.prepare("UPDATE sales SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), sale.id);
    if (sale.customer_id) partyService.updateCustomerBalance(sale.customer_id);
    return sale;
  });

  try {
    txn();
    return success(res, null, 'Sale cancelled');
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

function convert(req, res) {
  try {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!sale) return error(res, 'Document not found', 404, null, 'ERR_NOT_FOUND');
    if (sale.status === 'converted') {
      return error(res, 'Document has already been converted', 400, null, 'ERR_ALREADY_CONVERTED');
    }
    if (sale.status === 'cancelled') {
      return error(res, 'Cannot convert a cancelled document', 400, null, 'ERR_CANCELLED');
    }

    const toType = oneOf(req.body.to_type, SALE_TYPES, 'Target type');

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    const payload = {
      invoice_type: toType,
      customer_id: sale.customer_id,
      invoice_date: today(),
      items: items.map((i) => ({
        product_id: i.product_id,
        product_name: i.product_name,
        hsn_code: i.hsn_code,
        quantity: i.quantity,
        unit_id: i.unit_id,
        unit_price: i.unit_price,
        discount_type: i.discount_type,
        discount_value: i.discount_value,
        tax_rate: i.tax_rate,
      })),
      discount_type: sale.discount_type,
      discount_value: sale.discount_value,
      shipping_charges: sale.shipping_charges,
      other_charges: sale.other_charges,
      notes: sale.notes,
      warehouse_id: sale.warehouse_id,
      status: 'completed',
    };

    // Source update and target creation share one transaction: if creation
    // fails (e.g. insufficient stock) the source stays in its original state.
    const newId = db.transaction(() => {
      const createdId = createSaleCore(payload, req.user.id);
      db.prepare("UPDATE sales SET status = 'converted', updated_at = ? WHERE id = ?").run(now(), sale.id);
      db.prepare('UPDATE sales SET converted_from = ? WHERE id = ?').run(sale.id, createdId);
      return createdId;
    })();

    return success(res, loadFullSale(newId), 'Document converted', 201);
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

function pdfInvoice(req, res) {
  try {
    const sale = db.prepare(`
      SELECT s.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
        c.gstin as customer_gstin, c.city as customer_city, c.state as customer_state
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?
    `).get(req.params.id);
    if (!sale) return error(res, 'Sale not found', 404, null, 'ERR_NOT_FOUND');

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    const company = db.prepare('SELECT * FROM company_settings WHERE id = 1').get() || {};

    // writeText picks the right font per script, so Gujarati company names,
    // customer names and product names all render alongside Latin text.
    const { doc, writeText, setBold, unicode } = createPdfDocument();
    const symbol = company.currency_symbol || '\u20B9';
    const money = (n) => pdfMoney(n, symbol, unicode);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sale.invoice_number}.pdf"`);
    doc.pipe(res);

    setBold(true);
    doc.fontSize(20);
    writeText(company.company_name || 'My Business', { align: 'left' });
    setBold(false);
    doc.fontSize(10).fillColor('#666');
    if (company.address) writeText(company.address);
    if (company.phone) writeText(`Phone: ${company.phone}`);
    if (company.gstin) writeText(`GSTIN: ${company.gstin}`);
    doc.fillColor('#000');

    doc.moveDown();
    const heading = sale.invoice_type === 'sale_return'
      ? 'CREDIT NOTE'
      : sale.invoice_type === 'estimate' ? 'ESTIMATE' : 'TAX INVOICE';
    setBold(true);
    doc.fontSize(16);
    writeText(heading, { align: 'right' });
    setBold(false);
    doc.fontSize(10);
    writeText(`No: ${sale.invoice_number}`, { align: 'right' });
    writeText(`Date: ${sale.invoice_date}`, { align: 'right' });

    doc.moveDown();
    setBold(true);
    doc.fontSize(12);
    writeText('Bill To:');
    setBold(false);
    doc.fontSize(10);
    writeText(sale.customer_name || 'Walk-in Customer');
    if (sale.customer_address) writeText(sale.customer_address);
    if (sale.customer_phone) writeText(`Phone: ${sale.customer_phone}`);
    if (sale.customer_gstin) writeText(`GSTIN: ${sale.customer_gstin}`);

    doc.moveDown();
    const tableTop = doc.y;
    setBold(true);
    doc.fontSize(9);
    writeText('#', { x: 50, y: tableTop, width: 30 });
    writeText('Item', { x: 80, y: tableTop, width: 180 });
    writeText('Qty', { x: 260, y: tableTop, width: 40 });
    writeText('Price', { x: 300, y: tableTop, width: 60 });
    writeText('Tax', { x: 360, y: tableTop, width: 50 });
    writeText('Total', { x: 420, y: tableTop, width: 80, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

    let y = tableTop + 25;
    setBold(false);
    items.forEach((item, i) => {
      if (y > 700) { doc.addPage(); y = 50; }
      writeText(String(i + 1), { x: 50, y, width: 30 });
      writeText(item.product_name, { x: 80, y, width: 180 });
      writeText(String(item.quantity), { x: 260, y, width: 40 });
      writeText(Number(item.unit_price).toFixed(2), { x: 300, y, width: 60 });
      writeText(Number(item.tax_amount).toFixed(2), { x: 360, y, width: 50 });
      writeText(Number(item.total).toFixed(2), { x: 420, y, width: 80, align: 'right' });
      y += 20;
    });

    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 15;
    const totalOpts = (yy) => ({ x: 350, y: yy, width: 195, align: 'right' });
    writeText(`Subtotal: ${money(sale.subtotal)}`, totalOpts(y));
    y += 15;
    if (sale.discount_amount) {
      writeText(`Discount: ${money(sale.discount_amount)}`, totalOpts(y));
      y += 15;
    }
    writeText(`Tax: ${money(sale.tax_amount)}`, totalOpts(y));
    y += 15;
    setBold(true);
    doc.fontSize(12);
    writeText(`Grand Total: ${money(sale.grand_total)}`, totalOpts(y));
    y += 18;
    setBold(false);
    doc.fontSize(10);
    writeText(`Paid: ${money(sale.paid_amount)}`, totalOpts(y));
    y += 15;
    writeText(`Balance: ${money(sale.balance_amount)}`, totalOpts(y));

    if (sale.notes) {
      y += 30;
      writeText(`Notes: ${sale.notes}`, { x: 50, y, width: 495 });
    }
    if (company.invoice_terms || sale.terms) {
      y += 20;
      writeText(`Terms: ${sale.terms || company.invoice_terms}`, { x: 50, y, width: 495 });
    }

    doc.end();
  } catch (err) {
    if (!res.headersSent) return error(res, err.message, 500, null, err.code);
    res.end();
  }
}

function whatsappLink(req, res) {
  try {
    const sale = db.prepare(`
      SELECT s.*, c.name as customer_name, c.phone as customer_phone
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?
    `).get(req.params.id);
    if (!sale) return error(res, 'Sale not found', 404);

    const company = db.prepare('SELECT company_name, currency_symbol FROM company_settings WHERE id = 1').get();
    const phone = (sale.customer_phone || '').replace(/\D/g, '');
    const msg = encodeURIComponent(
      `*${company.company_name}*\nInvoice: ${sale.invoice_number}\nDate: ${sale.invoice_date}\nAmount: ${company.currency_symbol}${sale.grand_total.toFixed(2)}\nPaid: ${company.currency_symbol}${sale.paid_amount.toFixed(2)}\nBalance: ${company.currency_symbol}${sale.balance_amount.toFixed(2)}\nThank you for your business!`
    );
    const link = phone ? `https://wa.me/91${phone.slice(-10)}?text=${msg}` : `https://wa.me/?text=${msg}`;
    return success(res, { link, message: decodeURIComponent(msg) });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, getById, create, update, cancel, convert, pdfInvoice, whatsappLink };
