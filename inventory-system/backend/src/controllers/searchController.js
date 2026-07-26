const db = require('../db/database');
const { success, error } = require('../utils/response');
const { sanitizeLike } = require('../utils/helpers');

function globalSearch(req, res) {
  try {
    const q = req.query.q;
    if (!q || q.length < 1) return success(res, { products: [], customers: [], suppliers: [], sales: [], purchases: [] });

    const s = `%${sanitizeLike(q)}%`;

    const products = db.prepare(`
      SELECT id, name, sku, barcode, selling_price, current_stock, 'product' as type
      FROM products WHERE is_active=1 AND (name LIKE ? ESCAPE '!' OR sku LIKE ? ESCAPE '!' OR barcode LIKE ? ESCAPE '!') LIMIT 10
    `).all(s, s, s);

    const customers = db.prepare(`
      SELECT id, name, phone, email, current_balance, 'customer' as type
      FROM customers WHERE is_active=1 AND (name LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!') LIMIT 10
    `).all(s, s, s);

    const suppliers = db.prepare(`
      SELECT id, name, phone, email, current_balance, 'supplier' as type
      FROM suppliers WHERE is_active=1 AND (name LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!') LIMIT 10
    `).all(s, s, s);

    const sales = db.prepare(`
      SELECT s.id, s.invoice_number as name, s.invoice_date, s.grand_total, c.name as party, 'sale' as type
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.invoice_number LIKE ? ESCAPE '!' OR c.name LIKE ? ESCAPE '!' LIMIT 10
    `).all(s, s);

    const purchases = db.prepare(`
      SELECT p.id, p.bill_number as name, p.bill_date, p.grand_total, s.name as party, 'purchase' as type
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.bill_number LIKE ? ESCAPE '!' OR s.name LIKE ? ESCAPE '!' LIMIT 10
    `).all(s, s);

    return success(res, { products, customers, suppliers, sales, purchases });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { globalSearch };
