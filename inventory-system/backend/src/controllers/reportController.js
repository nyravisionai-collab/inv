const db = require('../db/database');
const { success, error } = require('../utils/response');
const { today, round2 } = require('../utils/helpers');

function profitLoss(req, res) {
  try {
    const from = req.query.from_date || today().slice(0, 8) + '01';
    const to = req.query.to_date || today();

    const sales = db.prepare(`
      SELECT COALESCE(SUM(grand_total),0) as total, COALESCE(SUM(tax_amount),0) as tax
      FROM sales WHERE invoice_type IN ('sale','pos') AND status='completed' AND invoice_date BETWEEN ? AND ?
    `).get(from, to);

    const saleReturns = db.prepare(`
      SELECT COALESCE(SUM(grand_total),0) as total, COALESCE(SUM(tax_amount),0) as tax
      FROM sales WHERE invoice_type='sale_return' AND status='completed' AND invoice_date BETWEEN ? AND ?
    `).get(from, to);

    const cogs = db.prepare(`
      SELECT COALESCE(SUM(
        CASE WHEN s.invoice_type = 'sale_return' THEN -1 ELSE 1 END
        * si.quantity * COALESCE(NULLIF(si.cost_price, 0), p.purchase_price, 0)
      ),0) as total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.invoice_type IN ('sale','pos','sale_return') AND s.status='completed' AND s.invoice_date BETWEEN ? AND ?
    `).get(from, to);

    const otherIncome = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as total FROM incomes WHERE income_date BETWEEN ? AND ?
    `).get(from, to);

    const expenses = db.prepare(`
      SELECT category, SUM(amount) as total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category
    `).all(from, to);

    const totalExpenses = expenses.reduce((s, e) => s + e.total, 0);

    const netSales = sales.total - saleReturns.total;
    const grossProfit = netSales - cogs.total;
    const netProfit = grossProfit + otherIncome.total - totalExpenses;

    return success(res, {
      from, to,
      sales: sales.total,
      saleReturns: saleReturns.total,
      netSales,
      cogs: cogs.total,
      grossProfit,
      otherIncome: otherIncome.total,
      expenses,
      totalExpenses,
      netProfit,
      taxCollected: round2(sales.tax - saleReturns.tax),
    });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function balanceSheet(req, res) {
  try {
    const asOf = req.query.as_of || today();

    const cashAndBank = db.prepare(`
      SELECT account_name, account_type, current_balance FROM bank_accounts WHERE is_active = 1
    `).all();

    const stockValue = db.prepare(`
      SELECT COALESCE(SUM(
        COALESCE((SELECT SUM(pb.quantity * pb.purchase_price) FROM product_batches pb WHERE pb.product_id = products.id), 0)
        + MAX(COALESCE(current_stock, 0) - COALESCE((SELECT SUM(pb.quantity) FROM product_batches pb WHERE pb.product_id = products.id), 0), 0) * COALESCE(purchase_price, 0)
      ),0) as total FROM products WHERE is_active=1 AND is_service=0
    `).get().total;

    const receivables = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END),0) as total
      FROM customers WHERE is_active = 1
    `).get().total;

    const payables = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END),0) as total
      FROM suppliers WHERE is_active = 1
    `).get().total;

    const totalAssets = cashAndBank.reduce((s, a) => s + a.current_balance, 0) + stockValue + receivables;

    // Simplified equity from P&L
    const pl = db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(CASE WHEN invoice_type = 'sale_return' THEN -grand_total ELSE grand_total END),0)
         FROM sales WHERE invoice_type IN ('sale','pos','sale_return') AND status='completed' AND invoice_date <= ?) -
        (SELECT COALESCE(SUM(CASE WHEN s.invoice_type = 'sale_return' THEN -1 ELSE 1 END * si.quantity * COALESCE(NULLIF(si.cost_price, 0), p.purchase_price, 0)),0)
         FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id
         WHERE s.invoice_type IN ('sale','pos','sale_return') AND s.status='completed' AND s.invoice_date <= ?) -
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE expense_date <= ?) +
        (SELECT COALESCE(SUM(amount),0) FROM incomes WHERE income_date <= ?)
      as retained
    `).get(asOf, asOf, asOf, asOf);

    return success(res, {
      asOf,
      assets: {
        cashAndBank,
        stockValue,
        receivables,
        total: totalAssets,
      },
      liabilities: {
        payables,
        total: payables,
      },
      equity: {
        retainedEarnings: pl.retained,
        total: pl.retained,
      },
    });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function gstReport(req, res) {
  try {
    const from = req.query.from_date || today().slice(0, 8) + '01';
    const to = req.query.to_date || today();

    const companyState = db.prepare('SELECT state FROM company_settings WHERE id = 1').get()?.state || null;

    const outward = db.prepare(`
      SELECT s.id, s.invoice_number, s.invoice_date, c.name as party, c.gstin, c.state as party_state,
        COALESCE((SELECT SUM(si.taxable_amount) FROM sale_items si WHERE si.sale_id = s.id), s.subtotal) as subtotal,
        s.discount_amount, s.tax_amount, s.grand_total,
        CASE WHEN c.state IS NULL OR c.state = ? THEN 'intra' ELSE 'inter' END as supply_type
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.invoice_type IN ('sale','pos') AND s.status='completed' AND s.invoice_date BETWEEN ? AND ?
      ORDER BY s.invoice_date
    `).all(companyState, from, to);

    const inward = db.prepare(`
      SELECT p.id, p.bill_number, p.bill_date, s.name as party, s.gstin, s.state as party_state,
        COALESCE((SELECT SUM(pi.taxable_amount) FROM purchase_items pi WHERE pi.purchase_id = p.id), p.subtotal) as subtotal,
        p.discount_amount, p.tax_amount, p.grand_total,
        CASE WHEN s.state IS NULL OR s.state = ? THEN 'intra' ELSE 'inter' END as supply_type
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.bill_type='purchase' AND p.status='completed' AND p.bill_date BETWEEN ? AND ?
      ORDER BY p.bill_date
    `).all(companyState, from, to);

    /**
     * Split a document's tax into CGST/SGST (intra-state) or IGST (inter-state).
     * GSTR-1 and GSTR-3B both require this breakdown, which the previous
     * report did not provide.
     */
    const splitTax = (rows) => rows.map((r) => {
      const tax = Number(r.tax_amount) || 0;
      const intra = r.supply_type === 'intra';
      return {
        ...r,
        cgst: intra ? round2(tax / 2) : 0,
        sgst: intra ? round2(tax / 2) : 0,
        igst: intra ? 0 : round2(tax),
      };
    });

    const outwardRows = splitTax(outward);
    const inwardRows = splitTax(inward);

    const sumBy = (rows, key) => round2(rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0));

    // Rate-wise summary of outward supplies, derived from the line items.
    const rateWise = db.prepare(`
      SELECT si.tax_rate as rate,
        COALESCE(SUM(si.taxable_amount), 0) as taxable_value,
        COALESCE(SUM(si.tax_amount), 0) as tax_amount,
        COUNT(DISTINCT s.id) as invoice_count
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.invoice_type IN ('sale','pos') AND s.status='completed'
        AND s.invoice_date BETWEEN ? AND ?
      GROUP BY si.tax_rate
      ORDER BY si.tax_rate
    `).all(from, to).map((r) => ({
      rate: Number(r.rate) || 0,
      taxable_value: round2(r.taxable_value),
      tax_amount: round2(r.tax_amount),
      invoice_count: r.invoice_count,
    }));

    // HSN-wise summary, required for the HSN section of GSTR-1.
    const hsnWise = db.prepare(`
      SELECT COALESCE(NULLIF(si.hsn_code, ''), 'N/A') as hsn_code,
        COALESCE(SUM(si.quantity), 0) as quantity,
        COALESCE(SUM(si.taxable_amount), 0) as taxable_value,
        COALESCE(SUM(si.tax_amount), 0) as tax_amount,
        COALESCE(SUM(si.total), 0) as total_value
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.invoice_type IN ('sale','pos') AND s.status='completed'
        AND s.invoice_date BETWEEN ? AND ?
      GROUP BY COALESCE(NULLIF(si.hsn_code, ''), 'N/A')
      ORDER BY taxable_value DESC
    `).all(from, to).map((r) => ({
      hsn_code: r.hsn_code,
      quantity: round2(r.quantity),
      taxable_value: round2(r.taxable_value),
      tax_amount: round2(r.tax_amount),
      total_value: round2(r.total_value),
    }));

    const outputTax = sumBy(outwardRows, 'tax_amount');
    const inputTax = sumBy(inwardRows, 'tax_amount');

    return success(res, {
      from, to,
      companyState,
      outwardSupply: outwardRows,
      inwardSupply: inwardRows,
      outputTax,
      inputTax,
      netTax: round2(outputTax - inputTax),
      outputBreakdown: {
        cgst: sumBy(outwardRows, 'cgst'),
        sgst: sumBy(outwardRows, 'sgst'),
        igst: sumBy(outwardRows, 'igst'),
        taxable_value: sumBy(outwardRows, 'subtotal'),
      },
      inputBreakdown: {
        cgst: sumBy(inwardRows, 'cgst'),
        sgst: sumBy(inwardRows, 'sgst'),
        igst: sumBy(inwardRows, 'igst'),
        taxable_value: sumBy(inwardRows, 'subtotal'),
      },
      netBreakdown: {
        cgst: round2(sumBy(outwardRows, 'cgst') - sumBy(inwardRows, 'cgst')),
        sgst: round2(sumBy(outwardRows, 'sgst') - sumBy(inwardRows, 'sgst')),
        igst: round2(sumBy(outwardRows, 'igst') - sumBy(inwardRows, 'igst')),
      },
      rateWise,
      hsnWise,
    });
  } catch (err) {
    return error(res, err.message, 500, null, err.code);
  }
}

function salesReport(req, res) {
  try {
    const from = req.query.from_date || today().slice(0, 8) + '01';
    const to = req.query.to_date || today();
    const { group_by = 'date' } = req.query;

    let rows;
    if (group_by === 'customer') {
      rows = db.prepare(`
        SELECT c.name, COUNT(*) as invoices, SUM(s.grand_total) as total, SUM(s.paid_amount) as paid, SUM(s.balance_amount) as balance
        FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.invoice_type IN ('sale','pos') AND s.status='completed' AND s.invoice_date BETWEEN ? AND ?
        GROUP BY s.customer_id ORDER BY total DESC
      `).all(from, to);
    } else if (group_by === 'product') {
      rows = db.prepare(`
        SELECT si.product_name as name, SUM(si.quantity) as qty, SUM(si.total) as total
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.invoice_type IN ('sale','pos') AND s.status='completed' AND s.invoice_date BETWEEN ? AND ?
        GROUP BY si.product_id, si.product_name ORDER BY total DESC
      `).all(from, to);
    } else {
      rows = db.prepare(`
        SELECT invoice_date as date, COUNT(*) as invoices, SUM(grand_total) as total, SUM(tax_amount) as tax, SUM(paid_amount) as paid
        FROM sales WHERE invoice_type IN ('sale','pos') AND status='completed' AND invoice_date BETWEEN ? AND ?
        GROUP BY invoice_date ORDER BY invoice_date
      `).all(from, to);
    }

    const summary = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(grand_total),0) as total, COALESCE(SUM(tax_amount),0) as tax,
        COALESCE(SUM(paid_amount),0) as paid, COALESCE(SUM(balance_amount),0) as balance
      FROM sales WHERE invoice_type IN ('sale','pos') AND status='completed' AND invoice_date BETWEEN ? AND ?
    `).get(from, to);

    return success(res, { from, to, group_by, rows, summary });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function purchaseReport(req, res) {
  try {
    const from = req.query.from_date || today().slice(0, 8) + '01';
    const to = req.query.to_date || today();

    const rows = db.prepare(`
      SELECT p.bill_date as date, p.bill_number, s.name as supplier, p.grand_total as total, p.tax_amount as tax, p.paid_amount as paid, p.payment_status
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.bill_type='purchase' AND p.status='completed' AND p.bill_date BETWEEN ? AND ?
      ORDER BY p.bill_date
    `).all(from, to);

    const summary = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(grand_total),0) as total, COALESCE(SUM(tax_amount),0) as tax, COALESCE(SUM(paid_amount),0) as paid
      FROM purchases WHERE bill_type='purchase' AND status='completed' AND bill_date BETWEEN ? AND ?
    `).get(from, to);

    return success(res, { from, to, rows, summary });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function expenseReport(req, res) {
  try {
    const from = req.query.from_date || today().slice(0, 8) + '01';
    const to = req.query.to_date || today();

    const byCategory = db.prepare(`
      SELECT category, COUNT(*) as count, SUM(amount) as total
      FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC
    `).all(from, to);

    const rows = db.prepare(`
      SELECT * FROM expenses WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date DESC
    `).all(from, to);

    const total = byCategory.reduce((s, c) => s + c.total, 0);
    return success(res, { from, to, byCategory, rows, total });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function taxReport(req, res) {
  return gstReport(req, res);
}

function customerReport(req, res) {
  try {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.phone, c.current_balance, c.credit_limit,
        (SELECT COUNT(*) FROM sales WHERE customer_id=c.id AND status='completed') as total_invoices,
        (SELECT COALESCE(SUM(grand_total),0) FROM sales WHERE customer_id=c.id AND invoice_type IN ('sale','pos') AND status='completed') as total_sales
      FROM customers c WHERE c.is_active=1 ORDER BY total_sales DESC
    `).all();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function supplierReport(req, res) {
  try {
    const rows = db.prepare(`
      SELECT s.id, s.name, s.phone, s.current_balance,
        (SELECT COUNT(*) FROM purchases WHERE supplier_id=s.id AND status='completed') as total_bills,
        (SELECT COALESCE(SUM(grand_total),0) FROM purchases WHERE supplier_id=s.id AND bill_type='purchase' AND status='completed') as total_purchases
      FROM suppliers s WHERE s.is_active=1 ORDER BY total_purchases DESC
    `).all();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function outstandingReport(req, res) {
  try {
    const customers = db.prepare(`SELECT name, phone, current_balance as outstanding FROM customers WHERE is_active=1 AND current_balance > 0 ORDER BY current_balance DESC`).all();
    const suppliers = db.prepare(`SELECT name, phone, current_balance as payable FROM suppliers WHERE is_active=1 AND current_balance > 0 ORDER BY current_balance DESC`).all();
    return success(res, { customers, suppliers, customerOutstanding: customers.reduce((n, r) => n + Number(r.outstanding || 0), 0), supplierPayable: suppliers.reduce((n, r) => n + Number(r.payable || 0), 0) });
  } catch (err) { return error(res, err.message, 500); }
}

function productProfitReport(req, res) {
  try {
    const from = req.query.from_date || today().slice(0, 8) + '01'; const to = req.query.to_date || today();
    const rows = db.prepare(`SELECT si.product_name, SUM(si.quantity) quantity, ROUND(SUM(si.total),2) sales,
      ROUND(SUM(si.quantity * COALESCE(si.cost_price, 0)),2) cost,
      ROUND(SUM(si.total - si.quantity * COALESCE(si.cost_price, 0)),2) profit
      FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.invoice_type IN ('sale','pos') AND s.status='completed' AND s.invoice_date BETWEEN ? AND ? GROUP BY si.product_id, si.product_name ORDER BY profit DESC`).all(from, to);
    return success(res, { from, to, rows });
  } catch (err) { return error(res, err.message, 500); }
}

function customerProfitReport(req, res) {
  try {
    const from = req.query.from_date || today().slice(0, 8) + '01'; const to = req.query.to_date || today();
    const rows = db.prepare(`SELECT COALESCE(c.name, 'Walk-in Customer') customer_name, COUNT(DISTINCT s.id) invoices,
      ROUND(SUM(si.total),2) sales, ROUND(SUM(si.quantity * COALESCE(si.cost_price,0)),2) cost,
      ROUND(SUM(si.total - si.quantity * COALESCE(si.cost_price,0)),2) profit
      FROM sales s JOIN sale_items si ON si.sale_id=s.id LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.invoice_type IN ('sale','pos') AND s.status='completed' AND s.invoice_date BETWEEN ? AND ? GROUP BY s.customer_id ORDER BY profit DESC`).all(from, to);
    return success(res, { from, to, rows });
  } catch (err) { return error(res, err.message, 500); }
}

module.exports = {
  profitLoss, balanceSheet, gstReport, salesReport, purchaseReport,
  expenseReport, taxReport, customerReport, supplierReport, outstandingReport, productProfitReport, customerProfitReport,
};

// Creates a persistent server-side export for every report endpoint.  Calling
// the existing report functions through this small response collector keeps the
// PDF and on-screen report calculations exactly the same.
async function pdfExport(req, res) {
  const handlers = {
    'profit-loss': profitLoss, 'balance-sheet': balanceSheet, gst: gstReport,
    sales: salesReport, purchases: purchaseReport, expenses: expenseReport,
    tax: taxReport, customers: customerReport, suppliers: supplierReport, outstanding: outstandingReport, 'product-profit': productProfitReport, 'customer-profit': customerProfitReport,
    stock: require('./inventoryController').stockReport, expiry: require('./inventoryController').expiryReport, 'warehouse-stock': require('./inventoryController').warehouseStockReport,
  };
  const handler = handlers[req.params.name];
  if (!handler) return error(res, 'Unknown report', 404);
  let payload;
  const collector = { status() { return this; }, json(body) { payload = body; return body; } };
  try {
    handler(req, collector);
    if (!payload?.success) return error(res, payload?.message || 'Could not create report', 500);
    const { saveReportPdf } = require('../utils/exportPdf');
    const from = req.query.from_date || req.query.as_of || 'all';
    const result = await saveReportPdf({
      name: `${req.params.name}-${from}-${req.query.to_date || ''}-${Date.now()}`,
      title: `${req.params.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Report`,
      subtitle: `Period: ${from}${req.query.to_date ? ` to ${req.query.to_date}` : ''}`,
      data: payload.data,
    });
    return success(res, { fileName: result.fileName, folder: require('../config').exportDir }, 'PDF saved to system exports folder');
  } catch (err) { return error(res, err.message, 500); }
}
module.exports.pdfExport = pdfExport;
