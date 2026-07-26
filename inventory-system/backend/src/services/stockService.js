const db = require('../db/database');
const { round2, now } = require('../utils/helpers');
const { ValidationError } = require('../utils/validate');

/** Business setting: may stock be driven below zero? Defaults to "no". */
function negativeStockAllowed() {
  try {
    const row = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE id = 1').get();
    return !!(row && row.allow_negative_stock);
  } catch {
    // Column may not exist on a database created before this migration.
    return false;
  }
}

/**
 * Stock available for a product in a warehouse.
 *
 * Older databases (and products whose opening stock was recorded before
 * per-warehouse tracking existed) hold a figure on `products.current_stock`
 * with no matching `warehouse_stock` row. Treating that as zero would block
 * every sale of existing inventory, so fall back to the product-level total
 * when the product has no warehouse rows at all.
 */
function availableStock(productId, warehouseId) {
  const row = db
    .prepare('SELECT COALESCE(quantity, 0) as q FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?')
    .get(productId, warehouseId);
  if (row) return Number(row.q);

  const tracked = db
    .prepare('SELECT COUNT(*) as c FROM warehouse_stock WHERE product_id = ?')
    .get(productId);
  if (tracked && tracked.c > 0) {
    // The product is warehouse-tracked, just not stocked in this one.
    return 0;
  }

  const product = db
    .prepare('SELECT COALESCE(current_stock, 0) as q FROM products WHERE id = ?')
    .get(productId);
  return product ? Number(product.q) : 0;
}

/**
 * Throw unless `quantity` can be taken out of the given warehouse.
 * Services and inactive products are skipped by the caller.
 */
function assertStockAvailable(productId, quantity, warehouseId) {
  if (negativeStockAllowed()) return;
  const wh = warehouseId || getDefaultWarehouse()?.id;
  if (!wh) return;
  const available = availableStock(productId, wh);
  const needed = Math.abs(Number(quantity) || 0);
  if (needed > available + 1e-9) {
    const product = db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
    throw new ValidationError(
      `Insufficient stock for "${product?.name || `product #${productId}`}": available ${round2(available)}, required ${round2(needed)}`,
      'ERR_INSUFFICIENT_STOCK'
    );
  }
}

/** Validate a whole basket at once, aggregating repeats of the same product. */
function assertItemsAvailable(items, warehouseId) {
  if (negativeStockAllowed()) return;
  const totals = new Map();
  for (const item of items) {
    if (!item.product_id) continue;
    const product = db.prepare('SELECT is_service FROM products WHERE id = ?').get(item.product_id);
    if (!product || product.is_service) continue;
    const key = item.product_id;
    totals.set(key, (totals.get(key) || 0) + Math.abs(Number(item.quantity) || 0));
  }
  for (const [productId, qty] of totals) {
    assertStockAvailable(productId, qty, warehouseId);
  }
}

function getDefaultWarehouse() {
  return db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1').get()
    || db.prepare('SELECT id FROM warehouses WHERE is_active = 1 LIMIT 1').get();
}

function updateProductStock(productId) {
  const row = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM warehouse_stock WHERE product_id = ?').get(productId);
  db.prepare("UPDATE products SET current_stock = ?, updated_at = ? WHERE id = ?").run(round2(row.total), now(), productId);
  return row.total;
}

function adjustWarehouseStock(productId, warehouseId, qtyDelta) {
  const existing = db.prepare('SELECT id, quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?').get(productId, warehouseId);
  if (existing) {
    const newQty = round2(existing.quantity + qtyDelta);
    db.prepare("UPDATE warehouse_stock SET quantity = ?, updated_at = ? WHERE id = ?").run(newQty, now(), existing.id);
  } else {
    // First warehouse row for this product: seed it with any legacy
    // product-level stock so the migration does not silently lose inventory.
    const tracked = db.prepare('SELECT COUNT(*) as c FROM warehouse_stock WHERE product_id = ?').get(productId);
    const legacy = tracked && tracked.c === 0
      ? Number(db.prepare('SELECT COALESCE(current_stock, 0) as q FROM products WHERE id = ?').get(productId)?.q || 0)
      : 0;
    db.prepare('INSERT INTO warehouse_stock (product_id, warehouse_id, quantity) VALUES (?, ?, ?)')
      .run(productId, warehouseId, round2(legacy + qtyDelta));
  }
  return updateProductStock(productId);
}

function setWarehouseStock(productId, warehouseId, quantity) {
  const existing = db.prepare('SELECT id FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?').get(productId, warehouseId);
  if (existing) {
    db.prepare("UPDATE warehouse_stock SET quantity = ?, updated_at = ? WHERE id = ?").run(round2(quantity), now(), existing.id);
  } else {
    db.prepare('INSERT INTO warehouse_stock (product_id, warehouse_id, quantity) VALUES (?, ?, ?)').run(productId, warehouseId, round2(quantity));
  }
  return updateProductStock(productId);
}

function reduceStock(productId, quantity, warehouseId = null) {
  const wh = warehouseId || getDefaultWarehouse()?.id;
  if (!wh) return;
  adjustWarehouseStock(productId, wh, -Math.abs(quantity));
}

function increaseStock(productId, quantity, warehouseId = null) {
  const wh = warehouseId || getDefaultWarehouse()?.id;
  if (!wh) return;
  adjustWarehouseStock(productId, wh, Math.abs(quantity));
}

function checkLowStock() {
  const products = db.prepare(`
    SELECT id, name, current_stock, min_stock, reorder_level
    FROM products
    WHERE is_active = 1 AND is_service = 0 AND current_stock <= min_stock AND min_stock > 0
    ORDER BY current_stock ASC
  `).all();
  return products;
}

function createLowStockNotifications() {
  const low = checkLowStock();
  const admins = db.prepare("SELECT id FROM users WHERE role IN ('admin','manager') AND is_active = 1").all();
  const insert = db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
    VALUES (?, 'low_stock', ?, ?, 'product', ?)
  `);
  for (const p of low) {
    for (const u of admins) {
      const exists = db.prepare(`
        SELECT id FROM notifications
        WHERE user_id = ? AND type = 'low_stock' AND reference_id = ? AND is_read = 0
        AND date(created_at) = date('now','localtime')
      `).get(u.id, p.id);
      if (!exists) {
        insert.run(u.id, 'Low Stock Alert', `${p.name} is low on stock (${p.current_stock}). Min: ${p.min_stock}`, p.id);
      }
    }
  }
  return low.length;
}

module.exports = {
  negativeStockAllowed,
  availableStock,
  assertStockAvailable,
  assertItemsAvailable,
  getDefaultWarehouse,
  updateProductStock,
  adjustWarehouseStock,
  setWarehouseStock,
  reduceStock,
  increaseStock,
  checkLowStock,
  createLowStockNotifications,
};
