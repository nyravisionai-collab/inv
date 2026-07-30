const db = require('../db/database');
const { success, error, paginated } = require('../utils/response');
const { pageParams } = require('../utils/validate');
const { now, sanitizeLike } = require('../utils/helpers');
const stockService = require('../services/stockService');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Multipart form fields arrive as strings, so a checkbox that is off reaches
 * the server as the string "false" — truthy in JavaScript. Normalise before
 * storing flags.
 */
function toBool(value) {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false' && v !== 'null' && v !== 'undefined';
  }
  return !!value;
}

/** Remove a previously uploaded product photo that is no longer referenced. */
function removeUploadedImage(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/products/')) return;
  try {
    const file = path.join(path.resolve(config.uploadDir), 'products', path.basename(imagePath));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* a stale file is harmless — never fail the request over it */
  }
}

function list(req, res) {
  try {
    const { page = 1, limit = 20, search, category_id, brand_id, low_stock, is_active } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      where += ' AND (p.name LIKE ? ESCAPE \'!\' OR p.sku LIKE ? ESCAPE \'!\' OR p.barcode LIKE ? ESCAPE \'!\' OR p.hsn_code LIKE ? ESCAPE \'!\')';
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
    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });

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

    return paginated(res, rows, total, pageNo, lim);
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

    const image = req.file ? `/uploads/products/${req.file.filename}` : (req.body.image || null);

    // Reactivate soft-deleted product with same SKU if present
    if (sku) {
      const inactive = db.prepare('SELECT * FROM products WHERE sku = ? AND is_active = 0').get(sku);
      if (inactive) {
        db.prepare(`
          UPDATE products SET name=?, barcode=?, hsn_code=?, description=?, category_id=?, brand_id=?, unit_id=?,
            purchase_price=?, selling_price=?, mrp=?, tax_rate=?, tax_type=?, min_stock=?, max_stock=?,
            reorder_level=?, image=?, is_active=1, updated_at=?
          WHERE id=?
        `).run(
          name, barcode || null, hsn_code || null, description || null,
          category_id || null, brand_id || null, unit_id || null,
          Number(purchase_price) || 0, Number(selling_price) || 0, Number(mrp) || 0,
          Number(tax_rate) || 0, tax_type || 'exclusive',
          Number(min_stock) || 0, Number(max_stock) || 0, Number(reorder_level) || 0,
          image !== null ? image : inactive.image,
          now(), inactive.id
        );
        return success(res, db.prepare('SELECT * FROM products WHERE id = ?').get(inactive.id), 'Product restored', 201);
      }
    }

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
      toBool(has_batch) ? 1 : 0, toBool(has_expiry) ? 1 : 0, toBool(is_service) ? 1 : 0
    );

    const productId = result.lastInsertRowid;
    if (stock > 0 && !toBool(is_service)) {
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
    const sku = b.sku !== undefined ? (b.sku || null) : existing.sku;
    const barcode = b.barcode !== undefined ? (b.barcode || null) : existing.barcode;

    if (sku) {
      const ex = db.prepare('SELECT id, is_active FROM products WHERE sku = ? AND id != ?').get(sku, id);
      if (ex && ex.is_active) return error(res, 'SKU already exists');
    }
    if (barcode) {
      const ex = db.prepare('SELECT id, is_active FROM products WHERE barcode = ? AND id != ?').get(barcode, id);
      if (ex && ex.is_active) return error(res, 'Barcode already exists');
    }

    // Three cases: a new file was uploaded, `image` was explicitly cleared
    // (photo removed in the UI), or the field was not sent at all (keep).
    let image = existing.image;
    if (req.file) image = `/uploads/products/${req.file.filename}`;
    else if (b.image !== undefined) image = b.image || null;
    if (image !== existing.image) removeUploadedImage(existing.image);

    db.prepare(`
      UPDATE products SET
        name=?, sku=?, barcode=?, hsn_code=?, description=?, category_id=?, brand_id=?, unit_id=?,
        purchase_price=?, selling_price=?, mrp=?, tax_rate=?, tax_type=?, min_stock=?, max_stock=?,
        reorder_level=?, image=?, has_batch=?, has_expiry=?, is_service=?, is_active=?, updated_at=?
      WHERE id=?
    `).run(
      b.name ?? existing.name,
      sku,
      barcode,
      b.hsn_code !== undefined ? (b.hsn_code || null) : existing.hsn_code,
      b.description !== undefined ? (b.description || null) : existing.description,
      b.category_id !== undefined ? (b.category_id || null) : existing.category_id,
      b.brand_id !== undefined ? (b.brand_id || null) : existing.brand_id,
      b.unit_id !== undefined ? (b.unit_id || null) : existing.unit_id,
      b.purchase_price !== undefined ? Number(b.purchase_price) : existing.purchase_price,
      b.selling_price !== undefined ? Number(b.selling_price) : existing.selling_price,
      b.mrp !== undefined ? Number(b.mrp) : existing.mrp,
      b.tax_rate !== undefined ? Number(b.tax_rate) : existing.tax_rate,
      b.tax_type || existing.tax_type,
      b.min_stock !== undefined ? Number(b.min_stock) : existing.min_stock,
      b.max_stock !== undefined ? Number(b.max_stock) : existing.max_stock,
      b.reorder_level !== undefined ? Number(b.reorder_level) : existing.reorder_level,
      image,
      b.has_batch !== undefined ? (toBool(b.has_batch) ? 1 : 0) : existing.has_batch,
      b.has_expiry !== undefined ? (toBool(b.has_expiry) ? 1 : 0) : existing.has_expiry,
      b.is_service !== undefined ? (toBool(b.is_service) ? 1 : 0) : existing.is_service,
      b.is_active !== undefined ? (toBool(b.is_active) ? 1 : 0) : existing.is_active,
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

async function generateAllBarcodes(req, res) {
  try {
    const productsList = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC').all();
    const items = [];
    for (const p of productsList) {
      const code = p.barcode || p.sku || `P${p.id}`;
      const qr = await QRCode.toDataURL(code, { width: 200, margin: 2 });
      items.push({
        id: p.id,
        name: p.name,
        code,
        qr,
        price: p.selling_price,
        sku: p.sku || ''
      });
    }
    return success(res, items);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

async function generateStickersPdf(req, res) {
  try {
    const { items = [], label_size = 'medium' } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return error(res, 'Select at least one product for stickers', 400);
    }

    const { createPdfDocument, pdfMoney } = require('../utils/pdf');
    const { mirrorDocumentPdf } = require('../utils/exportPdf');
    const company = db.prepare('SELECT currency_symbol FROM company_settings WHERE id = 1').get() || {};
    const sym = company.currency_symbol || '₹';

    const stickers = [];
    for (const item of items) {
      if (!item.product_id) continue;
      const p = db.prepare('SELECT id, name, sku, barcode, selling_price FROM products WHERE id = ?').get(item.product_id);
      if (!p) continue;
      const qty = Math.max(1, Math.min(200, Number(item.quantity) || 1));
      const code = p.barcode || p.sku || `P${p.id}`;
      const qrDataUrl = await QRCode.toDataURL(code, { width: 120, margin: 1 });
      const imgBuf = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
      for (let i = 0; i < qty; i++) {
        stickers.push({ name: p.name, sku: p.sku || '', code, price: p.selling_price, imgBuf });
      }
    }
    if (!stickers.length) return error(res, 'No valid stickers to generate', 400);

    const { doc, writeText, setBold, unicode } = createPdfDocument({ margin: 25 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="barcode-stickers.pdf"`);
    doc.pipe(res);
    mirrorDocumentPdf(doc, 'barcode-stickers');

    let cols = 3; let rows = 7; let colW = 180; let rowH = 110;
    if (label_size === 'small') { cols = 4; rows = 8; colW = 135; rowH = 95; }
    else if (label_size === 'large') { cols = 2; rows = 5; colW = 270; rowH = 155; }

    const money = (n) => pdfMoney(n, sym, unicode);
    const startX = 25; const startY = 25;
    let col = 0; let row = 0;

    for (let i = 0; i < stickers.length; i++) {
      if (row >= rows) {
        doc.addPage();
        col = 0; row = 0;
      }
      const st = stickers[i];
      const x = startX + col * colW;
      const y = startY + row * rowH;

      doc.rect(x + 2, y + 2, colW - 6, rowH - 6).lineWidth(0.5).stroke('#ccc');

      const textX = x + 6;
      setBold(true);
      doc.fontSize(label_size === 'small' ? 8 : 10);
      writeText(st.name.slice(0, label_size === 'small' ? 18 : 28), { x: textX, y: y + 8, width: colW - 12 });
      setBold(false);
      doc.fontSize(7).fillColor('#555');
      if (st.sku) writeText(`SKU: ${st.sku}`, { x: textX, y: y + 22, width: colW - 12 });
      doc.fillColor('#000');

      const imgX = x + 8;
      const imgY = y + (st.sku ? 32 : 24);
      const imgSize = label_size === 'small' ? 45 : label_size === 'large' ? 70 : 55;
      try {
        doc.image(st.imgBuf, imgX, imgY, { width: imgSize, height: imgSize });
      } catch { /* ignore */ }

      const rightX = imgX + imgSize + 6;
      const rightW = colW - (imgSize + 20);
      setBold(true);
      doc.fontSize(label_size === 'small' ? 9 : 12).fillColor('#00796b');
      writeText(money(st.price), { x: rightX, y: imgY + 10, width: rightW });
      doc.fillColor('#000');
      setBold(false);
      doc.fontSize(7);
      writeText(st.code, { x: rightX, y: imgY + 28, width: rightW });

      col++;
      if (col >= cols) {
        col = 0;
        row++;
      }
    }

    doc.end();
  } catch (err) {
    if (!res.headersSent) return error(res, err.message, 500);
    res.end();
  }
}

function lowStock(req, res) {
  try {
    return success(res, stockService.checkLowStock());
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, getById, create, update, remove, getByBarcode, generateBarcode, generateAllBarcodes, generateStickersPdf, lowStock };
