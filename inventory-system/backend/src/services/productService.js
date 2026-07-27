const db = require('../db/database');
const { now, round2 } = require('../utils/helpers');

/**
 * Look up an active product by its exact (case-insensitive) name.
 */
function findByName(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  return db.prepare(
    'SELECT * FROM products WHERE is_active = 1 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1'
  ).get(clean) || null;
}

/** Build a unique SKU from a product name, e.g. "Basmati Rice" -> "BAS-1042". */
function generateSku(name) {
  const base = String(name || 'ITEM')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'ITEM';
  for (let i = 0; i < 50; i++) {
    const candidate = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
    const clash = db.prepare('SELECT id FROM products WHERE sku = ?').get(candidate);
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Return the product referenced by a document line, creating it when the name
 * typed by the user does not exist yet.
 *
 * Purchase entry is the fastest place to discover new stock, so a bill may
 * name an item that was never added to the catalogue. Rather than silently
 * dropping it (which would also drop the stock movement), the item is created
 * from the line data.
 */
function findOrCreateByName(line = {}) {
  const name = String(line.product_name || line.name || '').trim();
  if (!name) return null;

  const existing = findByName(name);
  if (existing) return existing;

  const purchasePrice = round2(Number(line.unit_price) || 0);
  const mrp = round2(Number(line.mrp) || 0);
  const sellingPrice = round2(
    Number(line.selling_price) || mrp || purchasePrice
  );

  const result = db.prepare(`
    INSERT INTO products (
      name, sku, barcode, hsn_code, category_id, brand_id, unit_id,
      purchase_price, selling_price, mrp, tax_rate, tax_type,
      min_stock, opening_stock, current_stock, is_active
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
  `).run(
    name,
    line.sku || generateSku(name),
    line.barcode || null,
    line.hsn_code || null,
    line.category_id || null,
    line.brand_id || null,
    line.unit_id || null,
    purchasePrice,
    sellingPrice,
    mrp,
    Number(line.tax_rate) || 0,
    line.tax_type || 'exclusive',
    0, 0, 0
  );

  return db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Push the price paid on a purchase bill back onto the product master so
 * stock valuation, margins and the next purchase all use the latest cost.
 *
 * Selling price and MRP are only touched when the bill carries them, or when
 * the product has no selling price yet (a brand-new item would otherwise sell
 * at zero).
 */
function applyPurchasePricing(productId, line = {}) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return null;

  const purchasePrice = round2(Number(line.unit_price) || 0);
  const mrp = Number(line.mrp) > 0 ? round2(Number(line.mrp)) : product.mrp;
  let sellingPrice = product.selling_price;
  if (Number(line.selling_price) > 0) sellingPrice = round2(Number(line.selling_price));
  else if (!Number(product.selling_price)) sellingPrice = round2(mrp || purchasePrice);

  db.prepare(`
    UPDATE products SET purchase_price = ?, selling_price = ?, mrp = ?, updated_at = ?
    WHERE id = ?
  `).run(purchasePrice, sellingPrice, mrp || 0, now(), productId);

  // Keep batch-level costing in step with the product master.
  if (line.batch_number) {
    db.prepare(`
      UPDATE product_batches SET purchase_price = ?, selling_price = ?
      WHERE product_id = ? AND batch_number = ?
    `).run(purchasePrice, sellingPrice, productId, line.batch_number);
  }

  return db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
}

module.exports = { findByName, findOrCreateByName, applyPurchasePricing, generateSku };
