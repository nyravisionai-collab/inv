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

let baseUrl = 'http://127.0.0.1:3099/api';
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
    const { status, data } = await req('POST', '/customers', { name: 'Cust A', phone: '111' });
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
});
