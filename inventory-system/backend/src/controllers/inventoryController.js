const db = require('../db/database');
const { success, error } = require('../utils/response');
const { now, today, sanitizeLike } = require('../utils/helpers');
const numberService = require('../services/numberService');
const stockService = require('../services/stockService');
const { toNumber, optionalDate, ValidationError } = require('../utils/validate');

// Categories
function listCategories(req, res) {
  try {
    const rows = db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id AND is_active = 1) as product_count,
        p.name as parent_name
      FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
      WHERE c.is_active = 1 ORDER BY c.name
    `).all();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createCategory(req, res) {
  try {
    const { name, description, parent_id } = req.body;
    if (!name) return error(res, 'Name required');
    // Reactivate soft-deleted category with same name
    const inactive = db.prepare('SELECT * FROM categories WHERE name = ? AND is_active = 0').get(name);
    if (inactive) {
      db.prepare('UPDATE categories SET description=?, parent_id=?, is_active=1, updated_at=? WHERE id=?')
        .run(description || null, parent_id || null, now(), inactive.id);
      return success(res, db.prepare('SELECT * FROM categories WHERE id = ?').get(inactive.id), 'Category restored', 201);
    }
    const active = db.prepare('SELECT id FROM categories WHERE name = ? AND is_active = 1').get(name);
    if (active) return error(res, 'Category already exists', 400);
    const result = db.prepare('INSERT INTO categories (name, description, parent_id) VALUES (?,?,?)')
      .run(name, description || null, parent_id || null);
    return success(res, db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid), 'Category created', 201);
  } catch (err) {
    return error(res, err.message.includes('UNIQUE') ? 'Category already exists' : err.message, 400);
  }
}

function updateCategory(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    const b = req.body;
    db.prepare('UPDATE categories SET name=?, description=?, parent_id=?, updated_at=? WHERE id=?')
      .run(b.name ?? existing.name, b.description !== undefined ? b.description : existing.description, b.parent_id !== undefined ? b.parent_id : existing.parent_id, now(), req.params.id);
    return success(res, db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id), 'Updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function deleteCategory(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    // Free unique name so it can be recreated
    const freed = `${existing.name}__del__${existing.id}`;
    db.prepare('UPDATE categories SET is_active = 0, name = ?, updated_at = ? WHERE id = ?')
      .run(freed, now(), req.params.id);
    return success(res, null, 'Category deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

// Brands
function listBrands(req, res) {
  try {
    const rows = db.prepare(`
      SELECT b.*, (SELECT COUNT(*) FROM products WHERE brand_id = b.id AND is_active = 1) as product_count
      FROM brands b WHERE b.is_active = 1 ORDER BY b.name
    `).all();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createBrand(req, res) {
  try {
    const { name, description } = req.body;
    if (!name) return error(res, 'Name required');
    const inactive = db.prepare('SELECT * FROM brands WHERE name = ? AND is_active = 0').get(name);
    if (inactive) {
      db.prepare('UPDATE brands SET description=?, is_active=1, updated_at=? WHERE id=?')
        .run(description || null, now(), inactive.id);
      return success(res, db.prepare('SELECT * FROM brands WHERE id = ?').get(inactive.id), 'Brand restored', 201);
    }
    const active = db.prepare('SELECT id FROM brands WHERE name = ? AND is_active = 1').get(name);
    if (active) return error(res, 'Brand already exists', 400);
    const result = db.prepare('INSERT INTO brands (name, description) VALUES (?,?)').run(name, description || null);
    return success(res, db.prepare('SELECT * FROM brands WHERE id = ?').get(result.lastInsertRowid), 'Brand created', 201);
  } catch (err) {
    return error(res, err.message.includes('UNIQUE') ? 'Brand already exists' : err.message, 400);
  }
}

function updateBrand(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    db.prepare('UPDATE brands SET name=?, description=?, updated_at=? WHERE id=?')
      .run(req.body.name ?? existing.name, req.body.description !== undefined ? req.body.description : existing.description, now(), req.params.id);
    return success(res, db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id), 'Updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function deleteBrand(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    const freed = `${existing.name}__del__${existing.id}`;
    db.prepare('UPDATE brands SET is_active = 0, name = ?, updated_at = ? WHERE id = ?')
      .run(freed, now(), req.params.id);
    return success(res, null, 'Brand deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

// Units
function listUnits(req, res) {
  try {
    return success(res, db.prepare('SELECT * FROM units WHERE is_active = 1 ORDER BY name').all());
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createUnit(req, res) {
  try {
    const { name, short_name, allow_fractional } = req.body;
    if (!name || !short_name) return error(res, 'Name and short name required');
    const inactive = db.prepare('SELECT * FROM units WHERE name = ? AND is_active = 0').get(name);
    if (inactive) {
      db.prepare('UPDATE units SET short_name=?, allow_fractional=?, is_active=1 WHERE id=?')
        .run(short_name, allow_fractional ? 1 : 0, inactive.id);
      return success(res, db.prepare('SELECT * FROM units WHERE id = ?').get(inactive.id), 'Unit restored', 201);
    }
    const active = db.prepare('SELECT id FROM units WHERE name = ? AND is_active = 1').get(name);
    if (active) return error(res, 'Unit already exists', 400);
    const result = db.prepare('INSERT INTO units (name, short_name, allow_fractional) VALUES (?,?,?)')
      .run(name, short_name, allow_fractional ? 1 : 0);
    return success(res, db.prepare('SELECT * FROM units WHERE id = ?').get(result.lastInsertRowid), 'Unit created', 201);
  } catch (err) {
    return error(res, err.message.includes('UNIQUE') ? 'Unit already exists' : err.message, 400);
  }
}

function deleteUnit(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    const freed = `${existing.name}__del__${existing.id}`;
    db.prepare('UPDATE units SET is_active = 0, name = ? WHERE id = ?').run(freed, req.params.id);
    return success(res, null, 'Unit deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

// Warehouses
function listWarehouses(req, res) {
  try {
    return success(res, db.prepare('SELECT * FROM warehouses WHERE is_active = 1 ORDER BY name').all());
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createWarehouse(req, res) {
  try {
    const { name, code, address, city, state, phone, is_default } = req.body;
    if (!name) return error(res, 'Name required');
    const inactive = db.prepare('SELECT * FROM warehouses WHERE name = ? AND is_active = 0').get(name);
    if (inactive) {
      if (is_default) db.prepare('UPDATE warehouses SET is_default = 0').run();
      db.prepare('UPDATE warehouses SET code=?, address=?, city=?, state=?, phone=?, is_default=?, is_active=1, updated_at=? WHERE id=?')
        .run(code || null, address || null, city || null, state || null, phone || null, is_default ? 1 : 0, now(), inactive.id);
      return success(res, db.prepare('SELECT * FROM warehouses WHERE id = ?').get(inactive.id), 'Warehouse restored', 201);
    }
    const active = db.prepare('SELECT id FROM warehouses WHERE name = ? AND is_active = 1').get(name);
    if (active) return error(res, 'Warehouse already exists', 400);
    if (is_default) db.prepare('UPDATE warehouses SET is_default = 0').run();
    const result = db.prepare('INSERT INTO warehouses (name, code, address, city, state, phone, is_default) VALUES (?,?,?,?,?,?,?)')
      .run(name, code || null, address || null, city || null, state || null, phone || null, is_default ? 1 : 0);
    return success(res, db.prepare('SELECT * FROM warehouses WHERE id = ?').get(result.lastInsertRowid), 'Warehouse created', 201);
  } catch (err) {
    return error(res, err.message.includes('UNIQUE') ? 'Warehouse already exists' : err.message, 400);
  }
}

function updateWarehouse(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    const b = req.body;
    if (b.is_default) db.prepare('UPDATE warehouses SET is_default = 0').run();
    db.prepare('UPDATE warehouses SET name=?, code=?, address=?, city=?, state=?, phone=?, is_default=?, updated_at=? WHERE id=?')
      .run(b.name ?? existing.name, b.code !== undefined ? b.code : existing.code, b.address !== undefined ? b.address : existing.address,
        b.city !== undefined ? b.city : existing.city, b.state !== undefined ? b.state : existing.state,
        b.phone !== undefined ? b.phone : existing.phone, b.is_default !== undefined ? (b.is_default ? 1 : 0) : existing.is_default,
        now(), req.params.id);
    return success(res, db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id), 'Updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function deleteWarehouse(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Not found', 404);
    const freed = `${existing.name}__del__${existing.id}`;
    const freedCode = existing.code ? `${existing.code}__del__${existing.id}` : null;
    db.prepare('UPDATE warehouses SET is_active = 0, is_default = 0, name = ?, code = ?, updated_at = ? WHERE id = ?')
      .run(freed, freedCode, now(), req.params.id);
    return success(res, null, 'Warehouse deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

// Stock Transfer
function listTransfers(req, res) {
  try {
    const rows = db.prepare(`
      SELECT st.*, fw.name as from_warehouse, tw.name as to_warehouse, u.full_name as created_by_name
      FROM stock_transfers st
      LEFT JOIN warehouses fw ON fw.id = st.from_warehouse_id
      LEFT JOIN warehouses tw ON tw.id = st.to_warehouse_id
      LEFT JOIN users u ON u.id = st.created_by
      ORDER BY st.transfer_date DESC
    `).all();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createTransfer(req, res) {
  const txn = db.transaction(() => {
    const { from_warehouse_id, to_warehouse_id, notes } = req.body;
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!from_warehouse_id || !to_warehouse_id || !items.length) {
      throw new ValidationError('From/To warehouse and items required', 'ERR_REQUIRED');
    }
    if (String(from_warehouse_id) === String(to_warehouse_id)) {
      throw new ValidationError('Warehouses must be different', 'ERR_SAME_WAREHOUSE');
    }
    const transfer_date = optionalDate(req.body.transfer_date, 'Transfer date') || today();

    // Both warehouses must exist. Transferring into an unknown warehouse used
    // to succeed and quietly destroy the quantity taken out of the source.
    for (const [label, id] of [['Source warehouse', from_warehouse_id], ['Destination warehouse', to_warehouse_id]]) {
      const wh = db.prepare('SELECT id FROM warehouses WHERE id = ? AND is_active = 1').get(id);
      if (!wh) throw new ValidationError(`${label} not found`, 'ERR_NOT_FOUND');
    }

    // Normalise quantities up-front: a non-numeric quantity previously slipped
    // through `Number(x) <= 0` (NaN comparisons are false) and wrote NaN into
    // warehouse_stock, wiping the product's stock to 0.
    const lines = items.map((item, index) => {
      const label = `Item ${index + 1}`;
      if (!item.product_id) throw new ValidationError(`${label}: product is required`, 'ERR_REQUIRED');
      const product = db.prepare('SELECT id FROM products WHERE id = ?').get(item.product_id);
      if (!product) throw new ValidationError(`${label}: product not found`, 'ERR_NOT_FOUND');
      const quantity = toNumber(item.quantity, `${label} quantity`, { min: 0 });
      if (quantity <= 0) throw new ValidationError(`${label}: quantity must be greater than zero`, 'ERR_QTY_POSITIVE');
      return { product_id: item.product_id, batch_id: item.batch_id || null, quantity };
    });

    for (const item of lines) {
      stockService.assertStockAvailable(item.product_id, item.quantity, from_warehouse_id);
      if (item.batch_id) stockService.assertBatchAvailable(item.batch_id, item.quantity);
    }

    const num = numberService.nextTransferNumber();
    const result = db.prepare(`
      INSERT INTO stock_transfers (transfer_number, from_warehouse_id, to_warehouse_id, transfer_date, notes, created_by)
      VALUES (?,?,?,?,?,?)
    `).run(num, from_warehouse_id, to_warehouse_id, transfer_date, notes || null, req.user.id);

    const tid = result.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO stock_transfer_items (transfer_id, product_id, batch_id, quantity) VALUES (?,?,?,?)');

    for (const item of lines) {
      insertItem.run(tid, item.product_id, item.batch_id, item.quantity);
      stockService.adjustWarehouseStock(item.product_id, from_warehouse_id, -Math.abs(item.quantity));
      stockService.adjustWarehouseStock(item.product_id, to_warehouse_id, Math.abs(item.quantity));
    }

    return db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(tid);
  });

  try {
    const t = txn();
    t.items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?').all(t.id);
    return success(res, t, 'Stock transferred', 201);
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

// Stock Adjustment
function listAdjustments(req, res) {
  try {
    const rows = db.prepare(`
      SELECT sa.*, w.name as warehouse_name, u.full_name as created_by_name
      FROM stock_adjustments sa
      LEFT JOIN warehouses w ON w.id = sa.warehouse_id
      LEFT JOIN users u ON u.id = sa.created_by
      ORDER BY sa.adjustment_date DESC
    `).all();
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function createAdjustment(req, res) {
  const txn = db.transaction(() => {
    const { warehouse_id, reason, notes } = req.body;
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) throw new ValidationError('Items required', 'ERR_EMPTY_LIST');
    const adjustment_date = optionalDate(req.body.adjustment_date, 'Adjustment date') || today();

    const wh = warehouse_id || stockService.getDefaultWarehouse()?.id;
    if (warehouse_id) {
      const found = db.prepare('SELECT id FROM warehouses WHERE id = ? AND is_active = 1').get(warehouse_id);
      if (!found) throw new ValidationError('Warehouse not found', 'ERR_NOT_FOUND');
    }

    // Unknown products used to be written as adjustment lines that changed
    // nothing, leaving a misleading audit record behind.
    items.forEach((item, index) => {
      const label = `Item ${index + 1}`;
      if (!item.product_id) throw new ValidationError(`${label}: product is required`, 'ERR_REQUIRED');
      const product = db.prepare('SELECT id FROM products WHERE id = ?').get(item.product_id);
      if (!product) throw new ValidationError(`${label}: product not found`, 'ERR_NOT_FOUND');
    });
    const num = numberService.nextAdjustmentNumber();
    const result = db.prepare(`
      INSERT INTO stock_adjustments (adjustment_number, warehouse_id, adjustment_date, reason, notes, created_by)
      VALUES (?,?,?,?,?,?)
    `).run(num, wh, adjustment_date, reason || null, notes || null, req.user.id);

    const aid = result.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO stock_adjustment_items (adjustment_id, product_id, batch_id, previous_qty, new_qty, difference) VALUES (?,?,?,?,?,?)');

    for (const item of items) {
      let prev;
      const newQty = Number(item.new_qty);
      if (!Number.isFinite(newQty) || newQty < 0) {
        throw new ValidationError('New quantity must be non-negative', 'ERR_QTY_NEGATIVE');
      }
      if (item.batch_id) {
        const batch = db.prepare('SELECT quantity FROM product_batches WHERE id = ? AND product_id = ?').get(item.batch_id, item.product_id);
        prev = batch ? Number(batch.quantity || 0) : 0;
        const diff = newQty - prev;
        insertItem.run(aid, item.product_id, item.batch_id || null, prev, newQty, diff);
        stockService.adjustWarehouseStock(item.product_id, wh, diff);
        stockService.setBatchStock(item.batch_id, newQty);
      } else {
        const ws = db.prepare('SELECT quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?').get(item.product_id, wh);
        prev = ws ? Number(ws.quantity || 0) : 0;
        const diff = newQty - prev;
        insertItem.run(aid, item.product_id, item.batch_id || null, prev, newQty, diff);
        stockService.setWarehouseStock(item.product_id, wh, newQty);
      }
    }

    return db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(aid);
  });

  try {
    const a = txn();
    a.items = db.prepare('SELECT * FROM stock_adjustment_items WHERE adjustment_id = ?').all(a.id);
    return success(res, a, 'Stock adjusted', 201);
  } catch (err) {
    return error(res, err.message, err.status || 500, null, err.code);
  }
}

function stockReport(req, res) {
  try {
    const { warehouse_id, category_id, search, low_stock } = req.query;
    let where = 'WHERE p.is_active = 1 AND p.is_service = 0';
    const params = [];
    if (category_id) { where += ' AND p.category_id = ?'; params.push(category_id); }
    if (search) { where += ' AND (p.name LIKE ? ESCAPE \'!\' OR p.sku LIKE ? ESCAPE \'!\')'; const s = `%${sanitizeLike(search)}%`; params.push(s, s); }
    if (low_stock === '1') { where += ' AND p.current_stock <= p.min_stock AND p.min_stock > 0'; }

    let rows;
    if (warehouse_id) {
      rows = db.prepare(`
        SELECT p.id, p.name, p.sku, p.barcode, p.purchase_price, p.selling_price, p.min_stock,
          COALESCE(ws.quantity, 0) as quantity, c.name as category_name, u.short_name as unit
        FROM products p
        LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.warehouse_id = ?
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN units u ON u.id = p.unit_id
        ${where}
        ORDER BY p.name
      `).all(warehouse_id, ...params);
    } else {
      rows = db.prepare(`
        SELECT p.id, p.name, p.sku, p.barcode, p.purchase_price, p.selling_price, p.min_stock,
          p.current_stock as quantity, c.name as category_name, u.short_name as unit,
          (
            COALESCE((SELECT SUM(pb.quantity * pb.purchase_price) FROM product_batches pb WHERE pb.product_id = p.id), 0)
            + MAX(COALESCE(p.current_stock, 0) - COALESCE((SELECT SUM(pb.quantity) FROM product_batches pb WHERE pb.product_id = p.id), 0), 0) * COALESCE(p.purchase_price, 0)
          ) as stock_value
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN units u ON u.id = p.unit_id
        ${where}
        ORDER BY p.name
      `).all(...params);
    }
    return success(res, rows);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function expiryReport(req, res) {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 90));
    const rows = db.prepare(`SELECT pb.id, p.name product_name, p.sku, w.name warehouse_name, pb.batch_number, pb.expiry_date, pb.quantity, pb.purchase_price
      FROM product_batches pb JOIN products p ON p.id=pb.product_id LEFT JOIN warehouses w ON w.id=pb.warehouse_id
      WHERE pb.quantity > 0 AND pb.expiry_date IS NOT NULL AND pb.expiry_date <= date('now', '+' || ? || ' days')
      ORDER BY pb.expiry_date`).all(days);
    return success(res, { days, rows });
  } catch (err) { return error(res, err.message, 500); }
}

function warehouseStockReport(req, res) {
  try {
    const rows = db.prepare(`SELECT w.name warehouse_name, p.sku, p.name product_name, COALESCE(ws.quantity, 0) quantity,
      p.purchase_price, ROUND(COALESCE(ws.quantity,0) * COALESCE(p.purchase_price,0),2) stock_value
      FROM warehouse_stock ws JOIN warehouses w ON w.id=ws.warehouse_id JOIN products p ON p.id=ws.product_id
      WHERE w.is_active=1 AND p.is_active=1 ORDER BY w.name, p.name`).all();
    return success(res, { rows });
  } catch (err) { return error(res, err.message, 500); }
}

module.exports = {
  listCategories, createCategory, updateCategory, deleteCategory,
  listBrands, createBrand, updateBrand, deleteBrand,
  listUnits, createUnit, deleteUnit,
  listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse,
  listTransfers, createTransfer,
  listAdjustments, createAdjustment,
  stockReport, expiryReport, warehouseStockReport,
};
