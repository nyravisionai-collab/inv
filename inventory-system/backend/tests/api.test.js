const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(__dirname, '../data/test-inventory.db');
process.env.PORT = '3099';
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'test';

const testDb = process.env.DB_PATH;
for (const f of [testDb, testDb + '.tmp']) {
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
}

const baseUrl = 'http://127.0.0.1:3099/api';
let server;

async function req(method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${urlPath}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

describe('Inventory API (no-auth offline mode)', () => {
  before(async () => {
    const { bootstrap } = require('../src/server');
    const started = await bootstrap();
    server = started.server;
    for (let i = 0; i < 40; i++) {
      try {
        const h = await fetch(`${baseUrl}/health`);
        if (h.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Server not healthy');
  });

  after(async () => {
    try {
      const db = require('../src/db/database');
      db.persist();
      db.close();
    } catch {}
    if (server) await new Promise((r) => server.close(() => r()));
  });

  it('health', async () => {
    const { status, data } = await req('GET', '/health');
    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
  });

  it('blocks public clients forwarded through the local frontend proxy', async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { 'x-forwarded-for': '8.8.8.8' } });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.code, 'ERR_LAN_ONLY');
  });

  it('dashboard without token', async () => {
    const { status, data } = await req('GET', '/dashboard');
    assert.strictEqual(status, 200);
    assert.ok(data.data);
  });

  it('products list empty initially or array', async () => {
    const { status, data } = await req('GET', '/products');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(data.data));
  });

  it('create product', async () => {
    const { status, data } = await req('POST', '/products', {
      name: 'Test Item', sku: 'T-1', purchase_price: 10, selling_price: 20, opening_stock: 5,
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(data.data.name, 'Test Item');
  });

  it('create customer', async () => {
    const { status } = await req('POST', '/customers', { name: 'Cust A', phone: '111' });
    assert.strictEqual(status, 201);
  });

  it('create sale', async () => {
    const products = await req('GET', '/products?limit=1');
    const p = products.data.data[0];
    const { status, data } = await req('POST', '/sales', {
      invoice_type: 'sale',
      items: [{ product_id: p.id, product_name: p.name, quantity: 1, unit_price: p.selling_price, tax_rate: 0 }],
      paid_amount: p.selling_price, status: 'completed',
    });
    assert.strictEqual(status, 201);
    assert.ok(data.data.invoice_number);
  });

  it('delete product removes from list', async () => {
    const list = await req('GET', '/products');
    const id = list.data.data[0].id;
    const del = await req('DELETE', `/products/${id}`);
    assert.strictEqual(del.status, 200);
    const again = await req('GET', '/products');
    assert.ok(!again.data.data.find((x) => x.id === id));
  });

  it('settings', async () => {
    const { status, data } = await req('GET', '/settings');
    assert.strictEqual(status, 200);
    assert.ok(data.data.company_name);
  });

  it('reports pl', async () => {
    const { status } = await req('GET', '/reports/profit-loss');
    assert.strictEqual(status, 200);
  });

  it('categories recreate after delete', async () => {
    const c = await req('POST', '/categories', { name: 'CatX' });
    assert.strictEqual(c.status, 201);
    const id = c.data.data.id;
    await req('DELETE', `/categories/${id}`);
    const c2 = await req('POST', '/categories', { name: 'CatX' });
    assert.strictEqual(c2.status, 201);
  });

  // ---- Regression tests for previously-reported defects ----

  it('rejects a sale that would drive stock negative', async () => {
    const p = await req('POST', '/products', {
      name: 'Guarded Item', sku: 'G-1', selling_price: 100, opening_stock: 2,
    });
    const id = p.data.data.id;

    const sale = await req('POST', '/sales', {
      items: [{ product_id: id, product_name: 'Guarded Item', quantity: 50, unit_price: 100 }],
      status: 'completed',
    });
    assert.strictEqual(sale.status, 400);
    assert.strictEqual(sale.data.code, 'ERR_INSUFFICIENT_STOCK');

    const after = await req('GET', `/products/${id}`);
    assert.strictEqual(after.data.data.current_stock, 2, 'stock must be untouched');
  });

  it('rejects negative quantity and negative price', async () => {
    const neg = await req('POST', '/sales', {
      items: [{ product_name: 'X', quantity: -5, unit_price: -100 }],
      status: 'completed',
    });
    assert.strictEqual(neg.status, 400);
  });

  it('escapes LIKE wildcards in search', async () => {
    await req('POST', '/products', { name: 'Rice_50kg', sku: 'LK-1', selling_price: 5 });
    await req('POST', '/products', { name: 'Rice X 50kg', sku: 'LK-2', selling_price: 5 });
    const r = await req('GET', '/products?search=Rice_');
    const names = r.data.data.map((x) => x.name);
    assert.ok(names.includes('Rice_50kg'));
    assert.ok(!names.includes('Rice X 50kg'), 'underscore must not act as a wildcard');
  });

  it('does not store passwords in the audit log', async () => {
    await req('POST', '/users', {
      username: 'audit_u', email: 'audit@x.com', password: 'SuperSecret123', full_name: 'Audit U',
    });
    const logs = await req('GET', '/audit-logs');
    const dump = JSON.stringify(logs.data.data || []);
    assert.ok(!dump.includes('SuperSecret123'), 'password must be redacted');
    assert.ok(dump.includes('REDACTED'));
  });

  it('strips HTML from strings nested inside arrays', async () => {
    const s = await req('POST', '/sales', {
      items: [{ product_name: '<script>bad</script>Item', quantity: 1, unit_price: 10 }],
      status: 'completed',
    });
    assert.strictEqual(s.status, 201);
    assert.ok(!s.data.data.items[0].product_name.includes('<script>'));
  });

  it('clamps hostile pagination values', async () => {
    const r = await req('GET', '/products?page=-5&limit=99999');
    assert.strictEqual(r.data.pagination.page, 1);
    assert.ok(r.data.pagination.limit <= 100);
  });

  it('computes tax-inclusive pricing correctly', async () => {
    const s = await req('POST', '/sales', {
      items: [{ product_name: 'MRP Item', quantity: 1, unit_price: 118, tax_rate: 18, tax_type: 'inclusive' }],
      status: 'completed',
    });
    assert.strictEqual(s.status, 201);
    assert.strictEqual(s.data.data.grand_total, 118);
    assert.strictEqual(s.data.data.tax_amount, 18);
  });

  it('snapshots cost price on each sale line', async () => {
    const p = await req('POST', '/products', {
      name: 'Cost Item', sku: 'C-1', purchase_price: 60, selling_price: 100, opening_stock: 5,
    });
    const id = p.data.data.id;
    const s = await req('POST', '/sales', {
      items: [{ product_id: id, product_name: 'Cost Item', quantity: 1, unit_price: 100 }],
      status: 'completed',
    });
    assert.strictEqual(s.data.data.items[0].cost_price, 60);

    // Changing the product price must not rewrite history.
    await req('PUT', `/products/${id}`, { purchase_price: 90 });
    const again = await req('GET', `/sales/${s.data.data.id}`);
    assert.strictEqual(again.data.data.items[0].cost_price, 60);
  });

  it('leaves the source document untouched when convert fails', async () => {
    const p = await req('POST', '/products', {
      name: 'Convert Item', sku: 'CV-1', selling_price: 10, opening_stock: 1,
    });
    const pid = p.data.data.id;
    const est = await req('POST', '/sales', {
      invoice_type: 'estimate',
      items: [{ product_id: pid, product_name: 'Convert Item', quantity: 999, unit_price: 10 }],
      status: 'completed',
    });
    assert.strictEqual(est.status, 201);

    const conv = await req('POST', `/sales/${est.data.data.id}/convert`, { to_type: 'sale' });
    assert.strictEqual(conv.status, 400, 'conversion must fail on insufficient stock');

    const src = await req('GET', `/sales/${est.data.data.id}`);
    assert.notStrictEqual(src.data.data.status, 'converted',
      'source must not be marked converted when the target was never created');
  });

  it('GST report includes CGST/SGST/IGST and HSN breakdowns', async () => {
    const r = await req('GET', '/reports/gst');
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.data.outputBreakdown);
    assert.ok('cgst' in r.data.data.outputBreakdown);
    assert.ok(Array.isArray(r.data.data.hsnWise));
    assert.ok(Array.isArray(r.data.data.rateWise));
  });

  it('keeps serving requests after a restore', async () => {
    const backup = await req('POST', '/backup');
    assert.strictEqual(backup.status, 200);
    const restored = await req('POST', '/restore', { filename: backup.data.data.db_backup });
    assert.strictEqual(restored.status, 200);
    // The old behaviour closed the database and 500'd on every later request.
    const after = await req('GET', '/products');
    assert.strictEqual(after.status, 200);
  });

  it('blocks path traversal in restore', async () => {
    const r = await req('POST', '/restore', { filename: '../../etc/passwd' });
    assert.ok(r.status >= 400);
  });

  it('updates an existing product successfully', async () => {
    const p = await req('POST', '/products', {
      name: 'Edit Item', sku: 'E-1', selling_price: 50, opening_stock: 10,
    });
    const id = p.data.data.id;
    const upd = await req('PUT', `/products/${id}`, {
      name: 'Updated Item Name', selling_price: 75,
    });
    assert.strictEqual(upd.status, 200);
    assert.strictEqual(upd.data.data.name, 'Updated Item Name');
    assert.strictEqual(upd.data.data.selling_price, 75);
  });

  it('generates all barcodes for active products', async () => {
    const r = await req('GET', '/products/barcodes/all');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.data.data));
    assert.ok(r.data.data.length > 0);
    assert.ok(r.data.data[0].qr);
    assert.ok(r.data.data[0].code);
  });
  it('purchase pushes the paid rate onto the product master', async () => {
    const p = await req('POST', '/products', {
      name: 'Cost Sync Item', sku: 'CS-1', purchase_price: 40, selling_price: 60, opening_stock: 0,
    });
    const id = p.data.data.id;

    const bill = await req('POST', '/purchases', {
      bill_type: 'purchase', status: 'completed',
      items: [{ product_id: id, product_name: 'Cost Sync Item', quantity: 4, unit_price: 55, mrp: 90 }],
    });
    assert.strictEqual(bill.status, 201);

    const after = await req('GET', `/products/${id}`);
    assert.strictEqual(after.data.data.purchase_price, 55);
    assert.strictEqual(after.data.data.mrp, 90);
    // Stock from the bill lands on the product too.
    assert.strictEqual(after.data.data.current_stock, 4);
  });

  it('creates an unknown product named on a purchase bill', async () => {
    const bill = await req('POST', '/purchases', {
      bill_type: 'purchase', status: 'completed',
      items: [{ product_name: 'Brand New Widget', quantity: 7, unit_price: 25, tax_rate: 18, mrp: 40 }],
    });
    assert.strictEqual(bill.status, 201);

    const list = await req('GET', '/products?search=Brand New Widget');
    const created = list.data.data.find((x) => x.name === 'Brand New Widget');
    assert.ok(created, 'product should have been created from the bill');
    assert.strictEqual(created.purchase_price, 25);
    assert.strictEqual(created.current_stock, 7);
    assert.ok(created.sku, 'a SKU is generated for auto-created products');
  });

  it('reuses the existing product when the typed name already exists', async () => {
    await req('POST', '/products', {
      name: 'Existing By Name', sku: 'EBN-1', purchase_price: 10, selling_price: 20, opening_stock: 1,
    });
    const before = await req('GET', '/products?search=Existing By Name');
    const count = before.data.data.filter((x) => x.name === 'Existing By Name').length;

    await req('POST', '/purchases', {
      bill_type: 'purchase', status: 'completed',
      items: [{ product_name: 'existing by name', quantity: 2, unit_price: 12 }],
    });

    const after = await req('GET', '/products?search=Existing By Name');
    const matches = after.data.data.filter((x) => x.name === 'Existing By Name');
    assert.strictEqual(matches.length, count, 'no duplicate product is created');
    assert.strictEqual(matches[0].purchase_price, 12);
    assert.strictEqual(matches[0].current_stock, 3);
  });

  it('creates and lists brands', async () => {
    const created = await req('POST', '/brands', { name: 'Acme', description: 'Test brand' });
    assert.strictEqual(created.status, 201);
    const list = await req('GET', '/brands');
    assert.ok(list.data.data.find((b) => b.name === 'Acme'));

    const updated = await req('PUT', `/brands/${created.data.data.id}`, { name: 'Acme Corp' });
    assert.strictEqual(updated.data.data.name, 'Acme Corp');

    const removed = await req('DELETE', `/brands/${created.data.data.id}`);
    assert.strictEqual(removed.status, 200);
    const after = await req('GET', '/brands');
    assert.ok(!after.data.data.find((b) => b.id === created.data.data.id));
  });

  it('keeps a product photo path when one is supplied', async () => {
    const p = await req('POST', '/products', {
      name: 'Photo Item', sku: 'PH-1', selling_price: 10, image: '/uploads/products/sample.png',
    });
    assert.strictEqual(p.data.data.image, '/uploads/products/sample.png');

    const cleared = await req('PUT', `/products/${p.data.data.id}`, { image: '' });
    assert.strictEqual(cleared.data.data.image, null);
  });
  it('lists POS bills alongside sale invoices, with the customer attached', async () => {
    const cust = await req('POST', '/customers', { name: 'Counter Cust', phone: '999' });
    const custId = cust.data.data.id;
    const prod = await req('POST', '/products', {
      name: 'POS Item', sku: 'POS-1', selling_price: 30, opening_stock: 10,
    });

    const pos = await req('POST', '/sales', {
      invoice_type: 'pos', customer_id: custId, status: 'completed',
      items: [{ product_id: prod.data.data.id, product_name: 'POS Item', quantity: 2, unit_price: 30 }],
      paid_amount: 60,
    });
    assert.strictEqual(pos.status, 201);

    // The Sale Invoices screen asks for both kinds in one request.
    const list = await req('GET', '/sales?type=sale,pos');
    const row = list.data.data.find((x) => x.id === pos.data.data.id);
    assert.ok(row, 'POS bill must appear in the sale invoice list');
    assert.strictEqual(row.customer_name, 'Counter Cust');
    assert.strictEqual(row.invoice_type, 'pos');

    // ...and the POS sale moved stock like any other sale.
    const after = await req('GET', `/products/${prod.data.data.id}`);
    assert.strictEqual(after.data.data.current_stock, 8);
  });

  it('rejects an unknown invoice type filter', async () => {
    const r = await req('GET', '/sales?type=not_a_type');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.data.code, 'ERR_INVALID_ENUM');
  });
});
