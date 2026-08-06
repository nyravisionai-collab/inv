const db = require('../db/database');
const { success, error } = require('../utils/response');
const { sanitizeLike } = require('../utils/helpers');

function globalSearch(req, res) {
  try {
    const q = req.query.q;
    if (!q || q.length < 1) return success(res, { products: [], parties: [], parties: [], sales: [], purchases: [] });

    const s = `%${sanitizeLike(q)}%`;

    const products = db.prepare(`
      SELECT id, name, sku, barcode, selling_price, current_stock, 'product' as type
      FROM products WHERE is_active=1 AND (name LIKE ? ESCAPE '!' OR sku LIKE ? ESCAPE '!' OR barcode LIKE ? ESCAPE '!') LIMIT 10
    `).all(s, s, s);

    const parties = db.prepare(`
      SELECT id, name, phone, email, current_balance, 'party' as type
      FROM parties WHERE is_active=1 AND (name LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!') LIMIT 10
    `).all(s, s, s);

    const sales = db.prepare(`
      SELECT s.id, s.invoice_number as name, s.invoice_date, s.grand_total, c.name as party, 'sale' as type
      FROM sales s LEFT JOIN parties c ON c.id = s.party_id
      WHERE s.invoice_number LIKE ? ESCAPE '!' OR c.name LIKE ? ESCAPE '!' LIMIT 10
    `).all(s, s);

    const purchases = db.prepare(`
      SELECT p.id, p.bill_number as name, p.bill_date, p.grand_total, s.name as party, 'purchase' as type
      FROM purchases p LEFT JOIN parties s ON s.id = p.party_id
      WHERE p.bill_number LIKE ? ESCAPE '!' OR s.name LIKE ? ESCAPE '!' LIMIT 10
    `).all(s, s);

    return success(res, { products, parties, sales, purchases });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { globalSearch };
