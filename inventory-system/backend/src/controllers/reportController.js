const db = require('../db/database');
const { success, error } = require('../utils/response');
const { today } = require('../utils/helpers');

function profitLoss(req, res) {
  try {
    const from = req.query.from_date || today().slice(0, 8) + '01';
    const to = req.query.to_date || today();

    const sales = db.prepare(`
      SELECT COALESCE(SUM(grand_total),0) as total, COALESCE(SUM(tax_amount),0) as tax
      FROM sales WHERE invoice_type IN ('sale','pos') AND status='completed' AND invoice_date BETWEEN ? AND ?
    `).get(from, to);

    const saleReturns = db.prepare(`
      SELECT COALESCE(SUM(grand_total),0) as total
      FROM sales WHERE invoice_type='sale_return' AND status='completed' AND invoice_date BETWEEN ? AND ?
    `).get(from, to);

    const cogs = db.prepare(`
      SELECT COALESCE(SUM(si.quantity * COALESCE(p.purchase_price,0)),0) as total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.invoice_type IN ('sale','pos') AND s.status='completed' AND s.invoice_date BETWEEN ? AND ?
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
      taxCollected: sales.tax,
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
      SELECT COALESCE(SUM(current_stock * purchase_price),0) as total FROM products WHERE is_active=1 AND is_service=0
    `).get().total;

    const receivables = db.prepare(`
      SELECT COALESCE(SUM(balance_amount),0) as total FROM sales
      WHERE invoice_type IN ('sale','pos') AND status='completed' AND balance_amount > 0 AND invoice_date <= ?
    `).get(asOf).total;

    const payables = db.prepare(`
      SELECT COALESCE(SUM(balance_amount),0) as total FROM purchases
      WHERE bill_type='purchase' AND status='completed' AND balance_amount > 0 AND bill_date <= ?
    `).get(asOf).total;

    const totalAssets = cashAndBank.reduce((s, a) => s + a.current_balance, 0) + stockValue + receivables;

    // Simplified equity from P&L
    const pl = db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(grand_total),0) FROM sales WHERE invoice_type IN ('sale','pos') AND status='completed' AND invoice_date <= ?) -
        (SELECT COALESCE(SUM(si.quantity * COALESCE(p.purchase_price,0)),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id WHERE s.invoice_type IN ('sale','pos') AND s.status='completed' AND s.invoice_date <= ?) -
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

    const outward = db.prepare(`
      SELECT s.invoice_number, s.invoice_date, c.name as party, c.gstin,
        s.subtotal, s.tax_amount, s.grand_total,
        CASE WHEN c.state = (SELECT state FROM company_settings WHERE id=1) OR c.state IS NULL THEN 'intra' ELSE 'inter' END as supply_type
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.invoice_type IN ('sale','pos') AND s.status='completed' AND s.invoice_date BETWEEN ? AND ?
      ORDER BY s.invoice_date
    `).all(from, to);

    const inward = db.prepare(`
      SELECT p.bill_number, p.bill_date, s.name as party, s.gstin,
        p.subtotal, p.tax_amount, p.grand_total
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.bill_type='purchase' AND p.status='completed' AND p.bill_date BETWEEN ? AND ?
      ORDER BY p.bill_date
    `).all(from, to);

    const taxOnSales = outward.reduce((s, r) => s + r.tax_amount, 0);
    const taxOnPurchases = inward.reduce((s, r) => s + r.tax_amount, 0);

    return success(res, {
      from, to,
      outwardSupply: outward,
      inwardSupply: inward,
      outputTax: taxOnSales,
      inputTax: taxOnPurchases,
      netTax: taxOnSales - taxOnPurchases,
    });
  } catch (err) {
    return error(res, err.message, 500);
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

module.exports = {
  profitLoss, balanceSheet, gstReport, salesReport, purchaseReport,
  expenseReport, taxReport, customerReport, supplierReport,
};
