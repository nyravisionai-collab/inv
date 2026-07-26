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
});
