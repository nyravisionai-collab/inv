const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { now, today, calcLineTotal, calcInvoiceTotals, round2, sanitizeLike } = require('../utils/helpers');
const numberService = require('../services/numberService');
const stockService = require('../services/stockService');
const partyService = require('../services/partyService');
const PDFDocument = require('pdfkit');

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
      where += ' AND (s.invoice_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)';
      const s = `%${sanitizeLike(search)}%`;
      params.push(s, s, s);
    }

    const total = db.prepare(`
      SELECT COUNT(*) as c FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${where}
    `).get(...params).c;

    const lim = Math.min(100, +limit || 20);
    const offset = (Math.max(1, +page) - 1) * lim;

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

    return paginated(res, rows, total, +page || 1, lim);
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
    if (!sale) return error(res, 'Sale not found', 404);

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

function create(req, res) {
  const createTxn = db.transaction(() => {
    const {
      invoice_type = 'sale', customer_id, invoice_date, due_date, reference_number,
      items = [], discount_type = 'amount', discount_value = 0,
      shipping_charges = 0, other_charges = 0, round_off = 0,
      notes, terms, warehouse_id, paid_amount = 0, payment_mode = 'cash',
      bank_account_id, status = 'completed',
    } = req.body;

    if (!items.length) throw new Error('At least one item is required');

    const invoiceNumber = numberService.nextNumber(invoice_type);
    const date = invoice_date || today();
    const wh = warehouse_id || stockService.getDefaultWarehouse()?.id;

    const processedItems = items.map((item) => {
      const calc = calcLineTotal(item.quantity, item.unit_price, item.discount_type || 'amount', item.discount_value || 0, item.tax_rate || 0);
      return {
        product_id: item.product_id || null,
        product_name: item.product_name || item.name,
        hsn_code: item.hsn_code || null,
        batch_id: item.batch_id || null,
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
      INSERT INTO sales (
        invoice_number, invoice_type, customer_id, invoice_date, due_date, reference_number,
        status, payment_status, subtotal, discount_type, discount_value, discount_amount,
        tax_amount, shipping_charges, other_charges, round_off, grand_total, paid_amount,
        balance_amount, notes, terms, warehouse_id, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      invoiceNumber, invoice_type, customer_id || null, date, due_date || null, reference_number || null,
      status, paymentStatus, totals.subtotal, discount_type, Number(discount_value) || 0, totals.discountAmount,
      totals.taxAmount, Number(shipping_charges) || 0, Number(other_charges) || 0, Number(round_off) || 0,
      totals.grandTotal, paid, balance, notes || null, terms || null, wh || null, req.user.id
    );

    const saleId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, hsn_code, batch_id, quantity, unit_id, unit_price, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const item of processedItems) {
      insertItem.run(saleId, item.product_id, item.product_name, item.hsn_code, item.batch_id, item.quantity, item.unit_id, item.unit_price, item.discount_type, item.discount_value, item.discount_amount, item.tax_rate, item.tax_amount, item.total);

      // Stock movement for completed sales/pos
      if (status === 'completed' && item.product_id && ['sale', 'pos'].includes(invoice_type)) {
        const prod = db.prepare('SELECT is_service FROM products WHERE id = ?').get(item.product_id);
        if (prod && !prod.is_service) stockService.reduceStock(item.product_id, item.quantity, wh);
      }
      // Sale return increases stock
      if (status === 'completed' && item.product_id && invoice_type === 'sale_return') {
        const prod = db.prepare('SELECT is_service FROM products WHERE id = ?').get(item.product_id);
        if (prod && !prod.is_service) stockService.increaseStock(item.product_id, item.quantity, wh);
      }
    }

    // Record payment if paid
    if (paid > 0 && status === 'completed') {
      const payNum = numberService.nextNumber('payment_in');
      db.prepare(`
        INSERT INTO payments (payment_number, payment_type, party_type, party_id, payment_date, amount, payment_mode, bank_account_id, sale_id, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(payNum, 'payment_in', 'customer', customer_id || null, date, paid, payment_mode, bank_account_id || null, saleId, req.user.id);

      if (bank_account_id) {
        partyService.updateBankBalance(bank_account_id, paid, 'credit');
      } else {
        const cashAcc = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get();
        if (cashAcc) partyService.updateBankBalance(cashAcc.id, paid, 'credit');
      }
    }

    if (customer_id) partyService.updateCustomerBalance(customer_id);

    return db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  });

  try {
    const sale = createTxn();
    const full = db.prepare(`
      SELECT s.*, c.name as customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?
    `).get(sale.id);
    full.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    return success(res, full, 'Sale created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function update(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Sale not found', 404);
    if (existing.status === 'cancelled') return error(res, 'Cannot update cancelled sale');

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
    if (!sale) throw new Error('Sale not found');
    if (sale.status === 'cancelled') throw new Error('Already cancelled');

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
    return error(res, err.message, 500);
  }
}

function convert(req, res) {
  try {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!sale) return error(res, 'Document not found', 404);
    const { to_type } = req.body;
    if (!to_type) return error(res, 'Target type required');

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    req.body = {
      invoice_type: to_type,
      customer_id: sale.customer_id,
      invoice_date: today(),
      items: items.map(i => ({
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

    db.prepare("UPDATE sales SET status = 'converted', updated_at = ? WHERE id = ?").run(now(), sale.id);
    return create(req, res);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function pdfInvoice(req, res) {
  try {
    const sale = db.prepare(`
      SELECT s.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
        c.gstin as customer_gstin, c.city as customer_city, c.state as customer_state
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?
    `).get(req.params.id);
    if (!sale) return error(res, 'Sale not found', 404);

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    const company = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sale.invoice_number}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).text(company.company_name || 'My Business', { align: 'left' });
    doc.fontSize(10).fillColor('#666');
    if (company.address) doc.text(company.address);
    if (company.phone) doc.text(`Phone: ${company.phone}`);
    if (company.gstin) doc.text(`GSTIN: ${company.gstin}`);
    doc.fillColor('#000');

    doc.moveDown();
    doc.fontSize(16).text(sale.invoice_type === 'sale_return' ? 'CREDIT NOTE' : sale.invoice_type === 'estimate' ? 'ESTIMATE' : 'TAX INVOICE', { align: 'right' });
    doc.fontSize(10);
    doc.text(`No: ${sale.invoice_number}`, { align: 'right' });
    doc.text(`Date: ${sale.invoice_date}`, { align: 'right' });

    doc.moveDown();
    doc.fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(10);
    doc.text(sale.customer_name || 'Walk-in Customer');
    if (sale.customer_address) doc.text(sale.customer_address);
    if (sale.customer_phone) doc.text(`Phone: ${sale.customer_phone}`);
    if (sale.customer_gstin) doc.text(`GSTIN: ${sale.customer_gstin}`);

    doc.moveDown();
    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('#', 50, tableTop, { width: 30 });
    doc.text('Item', 80, tableTop, { width: 180 });
    doc.text('Qty', 260, tableTop, { width: 40 });
    doc.text('Price', 300, tableTop, { width: 60 });
    doc.text('Tax', 360, tableTop, { width: 50 });
    doc.text('Total', 420, tableTop, { width: 80, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

    let y = tableTop + 25;
    doc.font('Helvetica');
    items.forEach((item, i) => {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.text(String(i + 1), 50, y, { width: 30 });
      doc.text(item.product_name, 80, y, { width: 180 });
      doc.text(String(item.quantity), 260, y, { width: 40 });
      doc.text(item.unit_price.toFixed(2), 300, y, { width: 60 });
      doc.text(item.tax_amount.toFixed(2), 360, y, { width: 50 });
      doc.text(item.total.toFixed(2), 420, y, { width: 80, align: 'right' });
      y += 20;
    });

    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 15;
    doc.text(`Subtotal: ${company.currency_symbol || '₹'}${sale.subtotal.toFixed(2)}`, 350, y, { align: 'right' });
    y += 15;
    if (sale.discount_amount) { doc.text(`Discount: ${company.currency_symbol || '₹'}${sale.discount_amount.toFixed(2)}`, 350, y, { align: 'right' }); y += 15; }
    doc.text(`Tax: ${company.currency_symbol || '₹'}${sale.tax_amount.toFixed(2)}`, 350, y, { align: 'right' });
    y += 15;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text(`Grand Total: ${company.currency_symbol || '₹'}${sale.grand_total.toFixed(2)}`, 350, y, { align: 'right' });
    y += 15;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Paid: ${company.currency_symbol || '₹'}${sale.paid_amount.toFixed(2)}`, 350, y, { align: 'right' });
    y += 15;
    doc.text(`Balance: ${company.currency_symbol || '₹'}${sale.balance_amount.toFixed(2)}`, 350, y, { align: 'right' });

    if (sale.notes) {
      y += 30;
      doc.text(`Notes: ${sale.notes}`, 50, y);
    }
    if (company.invoice_terms || sale.terms) {
      y += 20;
      doc.text(`Terms: ${sale.terms || company.invoice_terms}`, 50, y);
    }

    doc.end();
  } catch (err) {
    return error(res, err.message, 500);
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
