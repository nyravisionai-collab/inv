const db = require('../db/database');
const { success, error } = require('../utils/response');
const { today } = require('../utils/helpers');
const stockService = require('../services/stockService');

function getDashboard(req, res) {
  try {
    const t = today();

    const todaySales = db.prepare(`
      SELECT COALESCE(SUM(grand_total), 0) as total, COUNT(*) as count
      FROM sales WHERE invoice_date = ? AND invoice_type IN ('sale','pos') AND status = 'completed'
    `).get(t);

    const todayPurchases = db.prepare(`
      SELECT COALESCE(SUM(grand_total), 0) as total, COUNT(*) as count
      FROM purchases WHERE bill_date = ? AND bill_type = 'purchase' AND status = 'completed'
    `).get(t);

    const cashInHand = db.prepare(`
      SELECT COALESCE(SUM(current_balance), 0) as total FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1
    `).get();

    const bankBalance = db.prepare(`
      SELECT COALESCE(SUM(current_balance), 0) as total FROM bank_accounts WHERE account_type != 'cash' AND is_active = 1
    `).get();

    // Profit: sales - COGS (purchase price * qty sold) - expenses today
    const salesRevenue = db.prepare(`
      SELECT COALESCE(SUM(grand_total), 0) as total FROM sales
      WHERE invoice_type IN ('sale','pos') AND status = 'completed' AND invoice_date = ?
    `).get(t);

    const cogs = db.prepare(`
      SELECT COALESCE(SUM(si.quantity * COALESCE(NULLIF(si.cost_price, 0), p.purchase_price, 0)), 0) as total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.invoice_type IN ('sale','pos') AND s.status = 'completed' AND s.invoice_date = ?
    `).get(t);

    const todayExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_date = ?
    `).get(t);

    const profit = (salesRevenue.total || 0) - (cogs.total || 0) - (todayExpenses.total || 0);

    const lowStock = stockService.checkLowStock();

    const recentTransactions = db.prepare(`
      SELECT 'sale' as type, id, invoice_number as number, invoice_date as date, grand_total as amount, payment_status as status,
        (SELECT name FROM customers WHERE id = sales.customer_id) as party
      FROM sales WHERE status != 'cancelled'
      UNION ALL
      SELECT 'purchase' as type, id, bill_number as number, bill_date as date, grand_total as amount, payment_status as status,
        (SELECT name FROM suppliers WHERE id = purchases.supplier_id) as party
      FROM purchases WHERE status != 'cancelled'
      ORDER BY date DESC LIMIT 15
    `).all();

    // Sales chart - last 7 days
    const salesChart = db.prepare(`
      SELECT invoice_date as date, COALESCE(SUM(grand_total), 0) as total, COUNT(*) as count
      FROM sales
      WHERE invoice_type IN ('sale','pos') AND status = 'completed'
        AND invoice_date >= date(?, '-6 days')
      GROUP BY invoice_date ORDER BY invoice_date
    `).all(t);

    // Purchase chart - last 7 days
    const purchaseChart = db.prepare(`
      SELECT bill_date as date, COALESCE(SUM(grand_total), 0) as total, COUNT(*) as count
      FROM purchases
      WHERE bill_type = 'purchase' AND status = 'completed'
        AND bill_date >= date(?, '-6 days')
      GROUP BY bill_date ORDER BY bill_date
    `).all(t);

    // Top selling products
    const topProducts = db.prepare(`
      SELECT p.id, p.name, p.sku, SUM(si.quantity) as qty_sold, SUM(si.total) as revenue
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      WHERE s.invoice_type IN ('sale','pos') AND s.status = 'completed'
        AND s.invoice_date >= date(?, '-30 days')
      GROUP BY p.id ORDER BY qty_sold DESC LIMIT 10
    `).all(t);

    // Monthly sales
    const monthlySales = db.prepare(`
      SELECT strftime('%Y-%m', invoice_date) as month, SUM(grand_total) as total
      FROM sales WHERE invoice_type IN ('sale','pos') AND status = 'completed'
        AND invoice_date >= date(?, '-11 months')
      GROUP BY month ORDER BY month
    `).all(t);

    const totalCustomers = db.prepare('SELECT COUNT(*) as c FROM customers WHERE is_active = 1').get().c;
    const totalSuppliers = db.prepare('SELECT COUNT(*) as c FROM suppliers WHERE is_active = 1').get().c;
    const totalProducts = db.prepare('SELECT COUNT(*) as c FROM products WHERE is_active = 1').get().c;
    const stockValue = db.prepare('SELECT COALESCE(SUM(current_stock * purchase_price), 0) as v FROM products WHERE is_active = 1').get().v;

    const receivables = db.prepare(`
      SELECT COALESCE(SUM(balance_amount), 0) as total FROM sales
      WHERE invoice_type IN ('sale','pos') AND status = 'completed' AND balance_amount > 0
    `).get();

    const payables = db.prepare(`
      SELECT COALESCE(SUM(balance_amount), 0) as total FROM purchases
      WHERE bill_type = 'purchase' AND status = 'completed' AND balance_amount > 0
    `).get();

    return success(res, {
      todaySales: todaySales.total,
      todaySalesCount: todaySales.count,
      todayPurchases: todayPurchases.total,
      todayPurchasesCount: todayPurchases.count,
      cashInHand: cashInHand.total,
      bankBalance: bankBalance.total,
      profit,
      lowStock,
      lowStockCount: lowStock.length,
      recentTransactions,
      salesChart,
      purchaseChart,
      topProducts,
      monthlySales,
      totalCustomers,
      totalSuppliers,
      totalProducts,
      stockValue,
      receivables: receivables.total,
      payables: payables.total,
    });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { getDashboard };
