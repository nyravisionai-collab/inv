const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { now, sanitizeLike } = require('../utils/helpers');
const stockService = require('../services/stockService');
const QRCode = require('qrcode');

function list(req, res) {
  try {
    const { page = 1, limit = 20, search, category_id, brand_id, low_stock, is_active } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      where += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.hsn_code LIKE ?)';
      const s = `%${sanitizeLike(search)}%`;
      params.push(s, s, s, s);
    }
    if (category_id) { where += ' AND p.category_id = ?'; params.push(category_id); }
    if (brand_id) { where += ' AND p.brand_id = ?'; params.push(brand_id); }
    if (low_stock === '1') { where += ' AND p.current_stock <= p.min_stock AND p.min_stock > 0'; }
    // Default: show only active products so soft-deleted rows leave the UI
    if (is_active === undefined || is_active === '' || is_active === null) {
      where += ' AND p.is_active = 1';
    } else {
      where += ' AND p.is_active = ?';
      params.push(is_active === '1' || is_active === 'true' || is_active === true ? 1 : 0);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM products p ${where}`).get(...params).c;
    const offset = (Math.max(1, +page) - 1) * Math.min(100, +limit || 20);
    const lim = Math.min(100, +limit || 20);

    const rows = db.prepare(`
      SELECT p.*, c.name as category_name, b.name as brand_name, u.name as unit_name, u.short_name as unit_short
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN units u ON u.id = p.unit_id
      ${where}
      ORDER BY p.name ASC
      LIMIT ? OFFSET ?
    `).all(...params, lim, offset);

    return paginated(res, rows, total, +page || 1, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getById(req, res) {
  try {
    const p = db.prepare(`
      SELECT p.*, c.name as category_name, b.name as brand_name, u.name as unit_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.id = ?
    `).get(req.params.id);
    if (!p) return error(res, 'Product not found', 404);

    p.batches = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date').all(p.id);
    p.warehouse_stock = db.prepare(`
      SELECT ws.*, w.name as warehouse_name FROM warehouse_stock ws
      JOIN warehouses w ON w.id = ws.warehouse_id WHERE ws.product_id = ?
    `).all(p.id);

    return success(res, p);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function create(req, res) {
  try {
    const {
      name, sku, barcode, hsn_code, description, category_id, brand_id, unit_id,
      purchase_price, selling_price, mrp, tax_rate, tax_type, min_stock, max_stock,
      reorder_level, opening_stock, has_batch, has_expiry, is_service, warehouse_id,
    } = req.body;

    if (!name) return error(res, 'Product name is required');

    if (sku) {
      const ex = db.prepare('SELECT id, is_active FROM products WHERE sku = ?').get(sku);
      if (ex && ex.is_active) return error(res, 'SKU already exists');
    }
    if (barcode) {
      const ex = db.prepare('SELECT id, is_active FROM products WHERE barcode = ?').get(barcode);
      if (ex && ex.is_active) return error(res, 'Barcode already exists');
    }

    // Reactivate soft-deleted product with same SKU if present
    if (sku) {
      const inactive = db.prepare('SELECT * FROM products WHERE sku = ? AND is_active = 0').get(sku);
      if (inactive) {
        db.prepare(`
          UPDATE products SET name=?, barcode=?, hsn_code=?, description=?, category_id=?, brand_id=?, unit_id=?,
            purchase_price=?, selling_price=?, mrp=?, tax_rate=?, tax_type=?, min_stock=?, max_stock=?,
            reorder_level=?, is_active=1, updated_at=?
          WHERE id=?
        `).run(
          name, barcode || null, hsn_code || null, description || null,
          category_id || null, brand_id || null, unit_id || null,
          Number(purchase_price) || 0, Number(selling_price) || 0, Number(mrp) || 0,
          Number(tax_rate) || 0, tax_type || 'exclusive',
          Number(min_stock) || 0, Number(max_stock) || 0, Number(reorder_level) || 0,
          now(), inactive.id
        );
        return success(res, db.prepare('SELECT * FROM products WHERE id = ?').get(inactive.id), 'Product restored', 201);
      }
    }

    const image = req.file ? `/uploads/products/${req.file.filename}` : (req.body.image || null);
    const stock = Number(opening_stock) || 0;

    const result = db.prepare(`
      INSERT INTO products (
        name, sku, barcode, hsn_code, description, category_id, brand_id, unit_id,
        purchase_price, selling_price, mrp, tax_rate, tax_type, min_stock, max_stock,
        reorder_level, opening_stock, current_stock, image, has_batch, has_expiry, is_service
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      name, sku || null, barcode || null, hsn_code || null, description || null,
      category_id || null, brand_id || null, unit_id || null,
      Number(purchase_price) || 0, Number(selling_price) || 0, Number(mrp) || 0,
      Number(tax_rate) || 0, tax_type || 'exclusive',
      Number(min_stock) || 0, Number(max_stock) || 0, Number(reorder_level) || 0,
      stock, stock, image,
      has_batch ? 1 : 0, has_expiry ? 1 : 0, is_service ? 1 : 0
    );

    const productId = result.lastInsertRowid;
    if (stock > 0 && !is_service) {
      const wh = warehouse_id || stockService.getDefaultWarehouse()?.id;
      if (wh) stockService.setWarehouseStock(productId, wh, stock);
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    return success(res, product, 'Product created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function update(req, res) {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) return error(res, 'Product not found', 404);

    const b = req.body;
    const image = req.file ? `/uploads/products/${req.file.filename}` : (b.image !== undefined ? b.image : existing.image);

    db.prepare(`
      UPDATE products SET
        name=?, sku=?, barcode=?, hsn_code=?, description=?, category_id=?, brand_id=?, unit_id=?,
        purchase_price=?, selling_price=?, mrp=?, tax_rate=?, tax_type=?, min_stock=?, max_stock=?,
        reorder_level=?, image=?, has_batch=?, has_expiry=?, is_service=?, is_active=?, updated_at=?
      WHERE id=?
    `).run(
      b.name ?? existing.name,
      b.sku !== undefined ? b.sku : existing.sku,
      b.barcode !== undefined ? b.barcode : existing.barcode,
      b.hsn_code !== undefined ? b.hsn_code : existing.hsn_code,
      b.description !== undefined ? b.description : existing.description,
      b.category_id !== undefined ? b.category_id : existing.category_id,
      b.brand_id !== undefined ? b.brand_id : existing.brand_id,
      b.unit_id !== undefined ? b.unit_id : existing.unit_id,
      b.purchase_price !== undefined ? Number(b.purchase_price) : existing.purchase_price,
      b.selling_price !== undefined ? Number(b.selling_price) : existing.selling_price,
      b.mrp !== undefined ? Number(b.mrp) : existing.mrp,
      b.tax_rate !== undefined ? Number(b.tax_rate) : existing.tax_rate,
      b.tax_type || existing.tax_type,
      b.min_stock !== undefined ? Number(b.min_stock) : existing.min_stock,
      b.max_stock !== undefined ? Number(b.max_stock) : existing.max_stock,
      b.reorder_level !== undefined ? Number(b.reorder_level) : existing.reorder_level,
      image,
      b.has_batch !== undefined ? (b.has_batch ? 1 : 0) : existing.has_batch,
      b.has_expiry !== undefined ? (b.has_expiry ? 1 : 0) : existing.has_expiry,
      b.is_service !== undefined ? (b.is_service ? 1 : 0) : existing.is_service,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      now(), id
    );

    return success(res, db.prepare('SELECT * FROM products WHERE id = ?').get(id), 'Product updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function remove(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'Product not found', 404);
    // Soft-delete and free UNIQUE sku/barcode so the same values can be reused
    const freedSku = existing.sku ? `${existing.sku}__del__${existing.id}` : null;
    const freedBarcode = existing.barcode ? `${existing.barcode}__del__${existing.id}` : null;
    db.prepare(`
      UPDATE products SET is_active = 0, sku = ?, barcode = ?, updated_at = ? WHERE id = ?
    `).run(freedSku, freedBarcode, now(), req.params.id);
    return success(res, null, 'Product deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getByBarcode(req, res) {
  try {
    const p = db.prepare(`
      SELECT p.*, c.name as category_name, u.short_name as unit_short
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.barcode = ? AND p.is_active = 1
    `).get(req.params.barcode);
    if (!p) return error(res, 'Product not found', 404);
    return success(res, p);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

async function generateBarcode(req, res) {
  try {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) return error(res, 'Product not found', 404);
    const code = p.barcode || p.sku || `P${p.id}`;
    const qr = await QRCode.toDataURL(code, { width: 300, margin: 2 });
    return success(res, { code, qr, product: { id: p.id, name: p.name, price: p.selling_price } });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function lowStock(req, res) {
  try {
    return success(res, stockService.checkLowStock());
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, getById, create, update, remove, getByBarcode, generateBarcode, lowStock };
