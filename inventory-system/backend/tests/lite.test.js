/**
 * Lite client tests — verifies the static /lite page and the exact request
 * shapes the old-phone UI (backend/public/lite/index.html) sends, including
 * the grand-total mirror: paid_amount must equal the server's grandTotal
 * rupee-for-rupee so cash bills come back payment_status "paid".
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(__dirname, '../data/test-lite.db');
process.env.PORT = '3098';
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'test';

const testDb = process.env.DB_PATH;
for (const f of [testDb, testDb + '.tmp']) {
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
}

const origin = 'http://127.0.0.1:3098';
let server;

async function req(method, urlPath, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${origin}${urlPath}`, opts);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}

describe('Lite legacy client (Windows Phone / IE-era browsers)', () => {
  before(async () => {
    const { bootstrap } = require('../src/server');
    server = (await bootstrap()).server;
    for (let i = 0; i < 40; i++) {
      try {
        const h = await fetch(`${origin}/api/health`);
        if (h.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Server not healthy');
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    for (const f of [testDb, testDb + '.tmp']) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
  });

  it('serves the lite page over plain HTTP', async () => {
    const res = await req('GET', '/lite/');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.ok(res.data.includes('Inventory Lite'), 'page title marker');
    assert.ok(res.data.includes('XMLHttpRequest'), 'ES5 XHR client present');
    assert.ok(!res.data.includes('type="module"'), 'no ES modules for old browsers');
  });

  it('serves the bundled Gujarati fonts the page references', async () => {
    const woff = await req('GET', '/lite/fonts/noto-sans-gujarati-gujarati-400-normal.woff');
    assert.strictEqual(woff.status, 200);
    const woff2 = await req('GET', '/lite/fonts/noto-sans-gujarati-gujarati-700-normal.woff2');
    assert.strictEqual(woff2.status, 200);
  });

  it('supports the full lite workflow: item → adjust → cash bill → history', async () => {
    // Units feed the "New item" dropdown
    const units = await req('GET', '/api/units');
    assert.strictEqual(units.status, 200);
    assert.ok(Array.isArray(units.data.data) && units.data.data.length > 0);

    // New item — same body the lite form posts
    const created = await req('POST', '/api/products', {
      name: 'Lite Test Item',
      selling_price: 50,
      purchase_price: 30,
      opening_stock: 10,
      tax_rate: 18,
      min_stock: 2,
    });
    assert.strictEqual(created.status, 201);
    const pid = created.data.data.id;
    assert.ok(pid);

    // Search — same query the sale/stock screens send
    const search = await req('GET', '/api/products?limit=12&search=Lite%20Test');
    assert.strictEqual(search.status, 200);
    assert.ok(search.data.data.some((p) => p.id === pid));

    // Stock adjust — lite sends absolute new_qty computed from current ± delta
    const adj = await req('POST', '/api/stock/adjustments', {
      reason: 'purchase',
      notes: 'lite',
      items: [{ product_id: pid, new_qty: 12 }],
    });
    assert.strictEqual(adj.status, 201);
    assert.strictEqual(adj.data.data.items[0].new_qty, 12);
    assert.strictEqual(adj.data.data.items[0].previous_qty, 10);

    // Cash bill — 2 × ₹50, 18% exclusive GST → grand total ₹118.00, paid in full.
    // 118 is what the phone's mirror of calcLineTotal/calcInvoiceTotals computes.
    const sale = await req('POST', '/api/sales', {
      invoice_type: 'pos',
      status: 'completed',
      items: [{ product_id: pid, product_name: 'Lite Test Item', quantity: 2, unit_price: 50, tax_rate: 18, tax_type: 'exclusive' }],
      discount_type: 'amount',
      discount_value: 0,
      payment_mode: 'cash',
      paid_amount: 118,
    });
    assert.strictEqual(sale.status, 201);
    assert.strictEqual(sale.data.data.grand_total, 118);
    assert.strictEqual(sale.data.data.payment_status, 'paid');
    assert.strictEqual(sale.data.data.balance_amount, 0);
    const saleId = sale.data.data.id;

    // Recent bills list + bill detail, as the Bills tab loads them
    const list = await req('GET', '/api/sales?type=sale,pos&limit=10&page=1');
    assert.strictEqual(list.status, 200);
    assert.ok(list.data.data.some((s) => s.id === saleId));

    const detail = await req('GET', `/api/sales/${saleId}`);
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.data.data.items.length, 1);
    assert.strictEqual(detail.data.data.items[0].product_name, 'Lite Test Item');

    // Dashboard KPIs used by the lite Home screen
    const dash = await req('GET', '/api/dashboard');
    assert.strictEqual(dash.status, 200);
    assert.ok(dash.data.data.todaySales >= 118);
  });

  it('rejects overselling with the error code the lite UI translates', async () => {
    const search = await req('GET', '/api/products?limit=1&search=Lite%20Test');
    const pid = search.data.data[0].id;
    const sale = await req('POST', '/api/sales', {
      invoice_type: 'pos',
      status: 'completed',
      items: [{ product_id: pid, product_name: 'Lite Test Item', quantity: 99999, unit_price: 1, tax_rate: 0 }],
      paid_amount: 0,
    });
    assert.strictEqual(sale.status, 400);
    assert.strictEqual(sale.data.success, false);
    assert.strictEqual(sale.data.code, 'ERR_INSUFFICIENT_STOCK');
  });

  it('resolves a bill line that references a product by id alone', async () => {
    // The API validator allows omitting product_name when product_id is sent;
    // the insert must still succeed (previously a NOT NULL 500).
    const search = await req('GET', '/api/products?limit=1&search=Lite%20Test');
    const pid = search.data.data[0].id;
    const sale = await req('POST', '/api/sales', {
      invoice_type: 'pos',
      status: 'completed',
      items: [{ product_id: pid, quantity: 1, unit_price: 10, tax_rate: 0 }],
      paid_amount: 10,
    });
    assert.strictEqual(sale.status, 201);
    assert.strictEqual(sale.data.data.items[0].product_name, 'Lite Test Item');
  });
});
