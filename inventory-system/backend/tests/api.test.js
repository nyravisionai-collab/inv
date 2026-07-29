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
  it('a party payment clears the receivable it belongs to', async () => {
    const cust = await req('POST', '/customers', { name: 'Partial Payer', phone: '4242' });
    const cid = cust.data.data.id;
    const prod = await req('POST', '/products', {
      name: 'Payable Widget', sku: 'PW-1', selling_price: 400, opening_stock: 20,
    });

    // POS bill of 400 with only 300 paid at the counter.
    const sale = await req('POST', '/sales', {
      invoice_type: 'pos', customer_id: cid, status: 'completed',
      items: [{ product_id: prod.data.data.id, product_name: 'Payable Widget', quantity: 1, unit_price: 400 }],
      paid_amount: 300,
    });
    assert.strictEqual(sale.data.data.balance_amount, 100);

    const before = await req('GET', '/dashboard');
    assert.ok(before.data.data.receivables >= 100);

    // "Record Payment" names the customer but no invoice.
    const pay = await req('POST', '/payments', {
      payment_type: 'payment_in', party_type: 'customer', party_id: cid, amount: 100,
    });
    assert.strictEqual(pay.status, 201);
    assert.strictEqual(pay.data.data.unallocated_amount, 0);

    // The invoice is settled, so it leaves the receivables figure.
    const settled = await req('GET', `/sales/${sale.data.data.id}`);
    assert.strictEqual(settled.data.data.balance_amount, 0);
    assert.strictEqual(settled.data.data.payment_status, 'paid');

    const after = await req('GET', '/dashboard');
    assert.strictEqual(after.data.data.receivables, before.data.data.receivables - 100);

    const cAfter = await req('GET', `/customers/${cid}`);
    assert.strictEqual(cAfter.data.data.current_balance, 0);
  });

  it('spreads one payment over the oldest bills and reverses cleanly on delete', async () => {
    const cid = (await req('POST', '/customers', { name: 'FIFO Cust' })).data.data.id;
    const pid = (await req('POST', '/products', {
      name: 'FIFO Item', sku: 'FI-1', selling_price: 100, opening_stock: 100,
    })).data.data.id;
    const mk = (qty, date) => req('POST', '/sales', {
      invoice_type: 'sale', customer_id: cid, status: 'completed', invoice_date: date,
      items: [{ product_id: pid, product_name: 'FIFO Item', quantity: qty, unit_price: 100 }],
      paid_amount: 0,
    });
    const older = await mk(2, '2026-01-01'); // 200
    const newer = await mk(3, '2026-02-01'); // 300

    const pay = await req('POST', '/payments', {
      payment_type: 'payment_in', party_type: 'customer', party_id: cid, amount: 250,
    });

    // Oldest bill is cleared first, the remainder lands on the next one.
    let a = await req('GET', `/sales/${older.data.data.id}`);
    let b = await req('GET', `/sales/${newer.data.data.id}`);
    assert.strictEqual(a.data.data.balance_amount, 0);
    assert.strictEqual(a.data.data.payment_status, 'paid');
    assert.strictEqual(b.data.data.balance_amount, 250);
    assert.strictEqual(b.data.data.payment_status, 'partial');

    // Deleting the payment must restore both invoices exactly.
    await req('DELETE', `/payments/${pay.data.data.id}`);
    a = await req('GET', `/sales/${older.data.data.id}`);
    b = await req('GET', `/sales/${newer.data.data.id}`);
    assert.strictEqual(a.data.data.balance_amount, 200);
    assert.strictEqual(a.data.data.payment_status, 'unpaid');
    assert.strictEqual(b.data.data.balance_amount, 300);
    assert.strictEqual((await req('GET', `/customers/${cid}`)).data.data.current_balance, 500);
  });

  it('keeps an overpayment on the customer account as credit', async () => {
    const cid = (await req('POST', '/customers', { name: 'Advance Cust' })).data.data.id;
    const pid = (await req('POST', '/products', {
      name: 'Advance Item', sku: 'AI-1', selling_price: 100, opening_stock: 10,
    })).data.data.id;
    await req('POST', '/sales', {
      invoice_type: 'sale', customer_id: cid, status: 'completed',
      items: [{ product_id: pid, product_name: 'Advance Item', quantity: 1, unit_price: 100 }],
      paid_amount: 0,
    });

    const pay = await req('POST', '/payments', {
      payment_type: 'payment_in', party_type: 'customer', party_id: cid, amount: 300,
    });
    assert.strictEqual(pay.data.data.unallocated_amount, 200);
    // 100 settled the bill, 200 sits as credit (negative = we owe them).
    assert.strictEqual((await req('GET', `/customers/${cid}`)).data.data.current_balance, -200);
  });

  it('releases money held by a cancelled invoice', async () => {
    const cid = (await req('POST', '/customers', { name: 'Cancel Payer' })).data.data.id;
    const pid = (await req('POST', '/products', {
      name: 'Cancel Item', sku: 'CI-1', selling_price: 100, opening_stock: 10,
    })).data.data.id;
    const mk = (date) => req('POST', '/sales', {
      invoice_type: 'sale', customer_id: cid, status: 'completed', invoice_date: date,
      items: [{ product_id: pid, product_name: 'Cancel Item', quantity: 1, unit_price: 100 }],
      paid_amount: 0,
    });
    const first = await mk('2026-03-01');
    const second = await mk('2026-04-01');
    await req('POST', '/payments', {
      payment_type: 'payment_in', party_type: 'customer', party_id: cid, amount: 100,
    });

    await req('POST', `/sales/${first.data.data.id}/cancel`);

    // The cancelled bill gives the money back, which then settles the other one.
    const cancelled = await req('GET', `/sales/${first.data.data.id}`);
    assert.strictEqual(cancelled.data.data.paid_amount, 0);
    const survivor = await req('GET', `/sales/${second.data.data.id}`);
    assert.strictEqual(survivor.data.data.balance_amount, 0);
    assert.strictEqual((await req('GET', `/customers/${cid}`)).data.data.current_balance, 0);
  });

  it('clears supplier payables the same way', async () => {
    const sid = (await req('POST', '/suppliers', { name: 'Payable Supp' })).data.data.id;
    await req('POST', '/purchases', {
      bill_type: 'purchase', supplier_id: sid, status: 'completed',
      items: [{ product_name: 'Supp Item', quantity: 5, unit_price: 40 }],
      paid_amount: 100,
    });
    assert.strictEqual((await req('GET', `/suppliers/${sid}`)).data.data.current_balance, 100);

    await req('POST', '/payments', {
      payment_type: 'payment_out', party_type: 'supplier', party_id: sid, amount: 100,
    });
    assert.strictEqual((await req('GET', `/suppliers/${sid}`)).data.data.current_balance, 0);
  });

  it('keeps inclusive-tax backend totals, GST taxable value, and overpayment validation in sync', async () => {
    const prod = await req('POST', '/products', {
      name: 'Audit Inclusive API Item', sku: 'AIA-1', selling_price: 118,
      purchase_price: 70, tax_rate: 18, tax_type: 'inclusive', opening_stock: 5,
    });

    const overpay = await req('POST', '/sales', {
      invoice_type: 'pos', status: 'completed',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 1, unit_price: 118, tax_rate: 18 }],
      paid_amount: 139.24,
    });
    assert.strictEqual(overpay.status, 400);
    assert.strictEqual(overpay.data.code, 'ERR_PAYMENT_RANGE');

    const sale = await req('POST', '/sales', {
      invoice_type: 'pos', status: 'completed', invoice_date: '2026-08-01',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 1, unit_price: 118, tax_rate: 18 }],
      paid_amount: 118,
    });
    assert.strictEqual(sale.status, 201);
    assert.strictEqual(sale.data.data.grand_total, 118);
    assert.strictEqual(sale.data.data.tax_amount, 18);
    assert.strictEqual(sale.data.data.balance_amount, 0);
    assert.strictEqual(sale.data.data.items[0].tax_type, 'inclusive');
    assert.strictEqual(sale.data.data.items[0].taxable_amount, 100);

    const gst = await req('GET', '/reports/gst?from_date=2026-08-01&to_date=2026-08-01');
    const row = gst.data.data.outwardSupply.find((x) => x.id === sale.data.data.id);
    assert.strictEqual(row.subtotal, 100);
    const rate = gst.data.data.rateWise.find((x) => x.rate === 18);
    assert.strictEqual(rate.taxable_value, 100);
  });

  it('applies bill-level discount before tax and rejects excessive bill discounts', async () => {
    const prod = await req('POST', '/products', {
      name: 'Audit Discount Tax Item', sku: 'ADT-1', selling_price: 100, purchase_price: 40, tax_rate: 18, opening_stock: 5,
    });
    const sale = await req('POST', '/sales', {
      invoice_type: 'sale', status: 'completed', discount_type: 'amount', discount_value: 10,
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 1, unit_price: 100, tax_rate: 18 }],
    });
    assert.strictEqual(sale.status, 201);
    assert.strictEqual(sale.data.data.tax_amount, 16.2);
    assert.strictEqual(sale.data.data.grand_total, 106.2);
    assert.strictEqual(sale.data.data.items[0].taxable_amount, 90);

    const bad = await req('POST', '/sales', {
      invoice_type: 'sale', status: 'completed', discount_type: 'amount', discount_value: 150,
      items: [{ product_name: 'Too Much Discount', quantity: 1, unit_price: 100 }],
    });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.data.code, 'ERR_DISCOUNT_RANGE');
  });

  it('nets sale and purchase returns into receivables, payables and outstanding lists', async () => {
    const beforeDash = await req('GET', '/dashboard');
    const cid = (await req('POST', '/customers', { name: 'Audit Return Net Cust' })).data.data.id;
    const pid = (await req('POST', '/products', {
      name: 'Audit Return Net Product', sku: 'ARNP-1', selling_price: 100, purchase_price: 40, opening_stock: 10,
    })).data.data.id;
    await req('POST', '/sales', {
      invoice_type: 'sale', customer_id: cid, status: 'completed',
      items: [{ product_id: pid, product_name: 'Audit Return Net Product', quantity: 2, unit_price: 100 }],
    });
    await req('POST', '/sales', {
      invoice_type: 'sale_return', customer_id: cid, status: 'completed',
      items: [{ product_id: pid, product_name: 'Audit Return Net Product', quantity: 1, unit_price: 100 }],
    });
    const cust = await req('GET', `/customers/${cid}`);
    assert.strictEqual(cust.data.data.current_balance, 100);
    const out = await req('GET', '/customers/outstanding');
    assert.strictEqual(out.data.data.find((x) => x.id === cid).outstanding, 100);
    const afterSalesDash = await req('GET', '/dashboard');
    assert.strictEqual(afterSalesDash.data.data.receivables, beforeDash.data.data.receivables + 100);

    const sid = (await req('POST', '/suppliers', { name: 'Audit Return Net Supp' })).data.data.id;
    await req('POST', '/purchases', {
      bill_type: 'purchase', supplier_id: sid, status: 'completed',
      items: [{ product_name: 'Audit Return Net Purchase Product', quantity: 2, unit_price: 100 }],
    });
    const created = (await req('GET', '/products?search=Audit Return Net Purchase Product')).data.data[0];
    await req('POST', '/purchases', {
      bill_type: 'purchase_return', supplier_id: sid, status: 'completed',
      items: [{ product_id: created.id, product_name: created.name, quantity: 1, unit_price: 100 }],
    });
    const supp = await req('GET', `/suppliers/${sid}`);
    assert.strictEqual(supp.data.data.current_balance, 100);
    const sout = await req('GET', '/suppliers/outstanding');
    assert.strictEqual(sout.data.data.find((x) => x.id === sid).outstanding, 100);
    const afterPurchaseDash = await req('GET', '/dashboard');
    assert.strictEqual(afterPurchaseDash.data.data.payables, afterSalesDash.data.data.payables + 100);
  });

  it('records paid sale and purchase returns as refund-direction payments with matching ledgers', async () => {
    const cashBefore = (await req('GET', '/banks')).data.data.find((b) => b.account_type === 'cash').current_balance;
    const cid = (await req('POST', '/customers', { name: 'Audit Refund Cust' })).data.data.id;
    const ret = await req('POST', '/sales', {
      invoice_type: 'sale_return', customer_id: cid, status: 'completed',
      items: [{ product_name: 'Audit Refund Service', quantity: 1, unit_price: 100 }],
      paid_amount: 100,
    });
    const retDetail = await req('GET', `/sales/${ret.data.data.id}`);
    assert.strictEqual(retDetail.data.data.payments[0].payment_type, 'payment_out');
    assert.ok(retDetail.data.data.payments[0].bank_account_id);
    assert.strictEqual((await req('GET', `/customers/${cid}`)).data.data.current_balance, 0);
    assert.strictEqual((await req('GET', `/customers/${cid}/ledger`)).data.data.closing_balance, 0);
    const cashAfterRefund = (await req('GET', '/banks')).data.data.find((b) => b.account_type === 'cash').current_balance;
    assert.strictEqual(cashAfterRefund, cashBefore - 100);

    const sid = (await req('POST', '/suppliers', { name: 'Audit Supplier Refund' })).data.data.id;
    const prod = await req('POST', '/products', {
      name: 'Audit Supplier Refund Item', sku: 'ASR-1', purchase_price: 50, selling_price: 80, opening_stock: 1,
    });
    const pret = await req('POST', '/purchases', {
      bill_type: 'purchase_return', supplier_id: sid, status: 'completed',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 1, unit_price: 50 }],
      paid_amount: 50,
    });
    const pretDetail = await req('GET', `/purchases/${pret.data.data.id}`);
    assert.strictEqual(pretDetail.data.data.payments[0].payment_type, 'payment_in');
    assert.ok(pretDetail.data.data.payments[0].bank_account_id);
    assert.strictEqual((await req('GET', `/suppliers/${sid}`)).data.data.current_balance, 0);
    assert.strictEqual((await req('GET', `/suppliers/${sid}/ledger`)).data.data.closing_balance, 0);
  });

  it('stores auto cash payment account ids, includes them in cash-book, and reverses cash on delete', async () => {
    const banksBefore = await req('GET', '/banks');
    const cash = banksBefore.data.data.find((b) => b.account_type === 'cash');
    const cid = (await req('POST', '/customers', { name: 'Audit Cash Payment Cust' })).data.data.id;
    const pid = (await req('POST', '/products', {
      name: 'Audit Cash Payment Product', sku: 'ACPP-1', selling_price: 100, purchase_price: 30, opening_stock: 3,
    })).data.data.id;
    const sale = await req('POST', '/sales', {
      invoice_type: 'sale', customer_id: cid, status: 'completed', invoice_date: '2026-12-31',
      items: [{ product_id: pid, product_name: 'Audit Cash Payment Product', quantity: 1, unit_price: 100 }],
      paid_amount: 100,
    });
    const detail = await req('GET', `/sales/${sale.data.data.id}`);
    const payment = detail.data.data.payments[0];
    assert.strictEqual(payment.bank_account_id, cash.id);

    let banks = await req('GET', '/banks');
    const cashAfterSale = banks.data.data.find((b) => b.id === cash.id).current_balance;
    assert.strictEqual(cashAfterSale, cash.current_balance + 100);
    const book = await req('GET', `/cash-book?bank_account_id=${cash.id}&from_date=2026-12-31&to_date=2026-12-31`);
    assert.strictEqual(book.data.data.closing_balance, cashAfterSale);
    assert.ok(book.data.data.entries.find((e) => e.ref === payment.payment_number));

    await req('DELETE', `/payments/${payment.id}`);
    banks = await req('GET', '/banks');
    assert.strictEqual(banks.data.data.find((b) => b.id === cash.id).current_balance, cash.current_balance);
    const afterSale = await req('GET', `/sales/${sale.data.data.id}`);
    assert.strictEqual(afterSale.data.data.paid_amount, 0);
    assert.strictEqual(afterSale.data.data.balance_amount, 100);
  });

  it('uses batch cost for COGS, updates batch quantity, and values stock by batches', async () => {
    const prod = await req('POST', '/products', {
      name: 'Audit Batch Valuation Item', sku: 'ABV-1', selling_price: 30, purchase_price: 0, has_batch: true,
    });
    await req('POST', '/purchases', {
      bill_type: 'purchase', status: 'completed',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 10, unit_price: 10, batch_number: 'ABV10' }],
    });
    await req('POST', '/purchases', {
      bill_type: 'purchase', status: 'completed',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 10, unit_price: 20, batch_number: 'ABV20' }],
    });
    const withBatches = await req('GET', `/products/${prod.data.data.id}`);
    const b10 = withBatches.data.data.batches.find((b) => b.batch_number === 'ABV10');
    const sale = await req('POST', '/sales', {
      invoice_type: 'sale', status: 'completed',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, batch_id: b10.id, quantity: 3, unit_price: 30 }],
    });
    assert.strictEqual(sale.data.data.items[0].cost_price, 10);
    const after = await req('GET', `/products/${prod.data.data.id}`);
    assert.strictEqual(after.data.data.batches.find((b) => b.batch_number === 'ABV10').quantity, 7);
    assert.strictEqual(after.data.data.current_stock, 17);
    const stock = await req('GET', '/stock/report?search=Audit Batch Valuation Item');
    assert.strictEqual(stock.data.data.find((x) => x.id === prod.data.data.id).stock_value, 270);
  });

  it('rejects stock transfers that would make a warehouse negative', async () => {
    const wh = await req('POST', '/warehouses', { name: 'Audit Transfer WH', code: 'ATW' });
    const prod = await req('POST', '/products', {
      name: `Audit Transfer Guard Item ${Date.now()}`, sku: `ATG-${Date.now()}`, selling_price: 10, purchase_price: 5, opening_stock: 5,
    });
    const transfer = await req('POST', '/stock/transfers', {
      from_warehouse_id: 1, to_warehouse_id: wh.data.data.id,
      items: [{ product_id: prod.data.data.id, quantity: 10 }],
    });
    assert.strictEqual(transfer.status, 400);
    assert.strictEqual(transfer.data.code, 'ERR_INSUFFICIENT_STOCK');
    assert.strictEqual((await req('GET', `/products/${prod.data.data.id}`)).data.data.current_stock, 5);
  });

  it('reverses COGS in profit-loss when a sale is fully returned', async () => {
    const prod = await req('POST', '/products', {
      name: 'Audit PnL Return Item', sku: 'APR-1', purchase_price: 60, selling_price: 100, opening_stock: 2,
    });
    await req('POST', '/sales', {
      invoice_type: 'sale', status: 'completed', invoice_date: '2026-11-11',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 1, unit_price: 100 }],
    });
    await req('POST', '/sales', {
      invoice_type: 'sale_return', status: 'completed', invoice_date: '2026-11-11',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 1, unit_price: 100 }],
    });
    const pl = await req('GET', '/reports/profit-loss?from_date=2026-11-11&to_date=2026-11-11');
    assert.strictEqual(pl.data.data.netSales, 0);
    assert.strictEqual(pl.data.data.cogs, 0);
    assert.strictEqual(pl.data.data.grossProfit, 0);
  });

  it('restores product cost when a purchase is cancelled', async () => {
    const prod = await req('POST', '/products', {
      name: 'Audit Cancel Cost Item', sku: 'ACCI-1', purchase_price: 40, selling_price: 70,
    });
    const bill = await req('POST', '/purchases', {
      bill_type: 'purchase', status: 'completed',
      items: [{ product_id: prod.data.data.id, product_name: prod.data.data.name, quantity: 1, unit_price: 55 }],
    });
    assert.strictEqual((await req('GET', `/products/${prod.data.data.id}`)).data.data.purchase_price, 55);
    await req('POST', `/purchases/${bill.data.data.id}/cancel`);
    const after = await req('GET', `/products/${prod.data.data.id}`);
    assert.strictEqual(after.data.data.purchase_price, 40);
    assert.strictEqual(after.data.data.current_stock, 0);
  });


  it('cancels sale and purchase returns back to their prior stock and party balances', async () => {
    const cid = (await req('POST', '/customers', { name: 'Audit Cancel Sale Return Cust' })).data.data.id;
    const saleProd = await req('POST', '/products', {
      name: 'Audit Cancel Sale Return Item', sku: 'ACSR-1', selling_price: 100, purchase_price: 40,
    });
    const sr = await req('POST', '/sales', {
      invoice_type: 'sale_return', customer_id: cid, status: 'completed',
      items: [{ product_id: saleProd.data.data.id, product_name: saleProd.data.data.name, quantity: 1, unit_price: 100 }],
    });
    assert.strictEqual((await req('GET', `/products/${saleProd.data.data.id}`)).data.data.current_stock, 1);
    assert.strictEqual((await req('GET', `/customers/${cid}`)).data.data.current_balance, -100);
    await req('POST', `/sales/${sr.data.data.id}/cancel`);
    assert.strictEqual((await req('GET', `/products/${saleProd.data.data.id}`)).data.data.current_stock, 0);
    assert.strictEqual((await req('GET', `/customers/${cid}`)).data.data.current_balance, 0);

    const sid = (await req('POST', '/suppliers', { name: 'Audit Cancel Purchase Return Supp' })).data.data.id;
    const purchaseProd = await req('POST', '/products', {
      name: 'Audit Cancel Purchase Return Item', sku: 'ACPR-1', purchase_price: 50, selling_price: 80, opening_stock: 2,
    });
    const pr = await req('POST', '/purchases', {
      bill_type: 'purchase_return', supplier_id: sid, status: 'completed',
      items: [{ product_id: purchaseProd.data.data.id, product_name: purchaseProd.data.data.name, quantity: 1, unit_price: 50 }],
    });
    assert.strictEqual((await req('GET', `/products/${purchaseProd.data.data.id}`)).data.data.current_stock, 1);
    assert.strictEqual((await req('GET', `/suppliers/${sid}`)).data.data.current_balance, -50);
    await req('POST', `/purchases/${pr.data.data.id}/cancel`);
    assert.strictEqual((await req('GET', `/products/${purchaseProd.data.data.id}`)).data.data.current_stock, 2);
    assert.strictEqual((await req('GET', `/suppliers/${sid}`)).data.data.current_balance, 0);
  });

  it('stores opening balance signs consistently with ledgers', async () => {
    const c = await req('POST', '/customers', { name: 'Audit Opening Credit Cust', opening_balance: 100, balance_type: 'credit' });
    assert.strictEqual(c.data.data.current_balance, -100);
    assert.strictEqual((await req('GET', `/customers/${c.data.data.id}/ledger`)).data.data.closing_balance, -100);

    const s = await req('POST', '/suppliers', { name: 'Audit Opening Debit Supp', opening_balance: 100, balance_type: 'debit' });
    assert.strictEqual(s.data.data.current_balance, -100);
    assert.strictEqual((await req('GET', `/suppliers/${s.data.data.id}/ledger`)).data.data.closing_balance, -100);
  });

  // ---------------------------------------------------------------------
  // Regression tests for the audit fixes
  // ---------------------------------------------------------------------

  it('issues a fresh expense number after an expense is deleted', async () => {
    const a = await req('POST', '/expenses', { category: 'Rent', amount: 100 });
    const b = await req('POST', '/expenses', { category: 'Rent', amount: 200 });
    const c = await req('POST', '/expenses', { category: 'Rent', amount: 300 });
    for (const r of [a, b, c]) assert.strictEqual(r.status, 201);

    // Deleting a row from the middle used to make COUNT(*)+1 land on a number
    // that the newest row still holds, so the *next* expense died with a
    // UNIQUE constraint error.
    assert.strictEqual((await req('DELETE', `/expenses/${b.data.data.id}`)).status, 200);

    const d = await req('POST', '/expenses', { category: 'Rent', amount: 400 });
    assert.strictEqual(d.status, 201, JSON.stringify(d.data));
    const used = [a, c].map((r) => r.data.data.expense_number);
    assert.ok(!used.includes(d.data.data.expense_number), d.data.data.expense_number);
  });

  it('rejects non-positive and non-numeric expense/income amounts', async () => {
    const neg = await req('POST', '/expenses', { category: 'Rent', amount: -500 });
    assert.strictEqual(neg.status, 400);
    assert.ok(['ERR_TOO_SMALL', 'ERR_AMOUNT_POSITIVE'].includes(neg.data.code), neg.data.code);

    const nan = await req('POST', '/expenses', { category: 'Rent', amount: 'abc' });
    assert.strictEqual(nan.status, 400);
    assert.strictEqual(nan.data.code, 'ERR_NOT_NUMBER');

    const negIncome = await req('POST', '/incomes', { category: 'Interest', amount: -99 });
    assert.strictEqual(negIncome.status, 400);
    assert.ok(['ERR_TOO_SMALL', 'ERR_AMOUNT_POSITIVE'].includes(negIncome.data.code), negIncome.data.code);
  });

  it('rejects journal entries with negative amounts or blank accounts', async () => {
    const negative = await req('POST', '/journals', {
      lines: [{ account_name: 'A', debit: -100 }, { account_name: 'B', credit: -100 }],
    });
    // -100 vs -100 "balanced" perfectly and used to be accepted.
    assert.strictEqual(negative.status, 400);

    const blank = await req('POST', '/journals', {
      lines: [{ account_name: '', debit: 50 }, { account_name: 'B', credit: 50 }],
    });
    assert.strictEqual(blank.status, 400);
    assert.strictEqual(blank.data.code, 'ERR_REQUIRED');

    const zero = await req('POST', '/journals', {
      lines: [{ account_name: 'A', debit: 0 }, { account_name: 'B', credit: 0 }],
    });
    assert.strictEqual(zero.status, 400);

    const ok = await req('POST', '/journals', {
      lines: [{ account_name: 'Cash', debit: 100 }, { account_name: 'Sales', credit: 100 }],
    });
    assert.strictEqual(ok.status, 201);
  });

  it('rejects payments with an invalid type or amount instead of a raw 500', async () => {
    const badType = await req('POST', '/payments', { payment_type: 'bogus', amount: 100 });
    assert.strictEqual(badType.status, 400);
    assert.strictEqual(badType.data.code, 'ERR_INVALID_ENUM');

    const nan = await req('POST', '/payments', { payment_type: 'payment_in', amount: 'abc' });
    assert.strictEqual(nan.status, 400);
    assert.strictEqual(nan.data.code, 'ERR_NOT_NUMBER');

    const negative = await req('POST', '/payments', { payment_type: 'payment_in', amount: -50 });
    assert.strictEqual(negative.status, 400);
  });

  it('does not destroy stock when a transfer carries a non-numeric quantity', async () => {
    const product = await req('POST', '/products', {
      name: 'Audit Transfer Guard Item', sku: 'ATG-1', purchase_price: 5, selling_price: 9, opening_stock: 50,
    });
    assert.strictEqual(product.status, 201, JSON.stringify(product.data));
    const pid = product.data.data.id;
    await req('POST', '/warehouses', { name: `Audit Transfer Guard WH ${Date.now()}`, code: `ATGWH${Date.now()}` });
    const warehouses = (await req('GET', '/warehouses')).data.data;

    const bad = await req('POST', '/stock/transfers', {
      from_warehouse_id: warehouses[0].id,
      to_warehouse_id: warehouses[warehouses.length - 1].id,
      items: [{ product_id: pid, quantity: 'abc' }],
    });
    // NaN used to pass the `Number(x) <= 0` check and zero out the stock row.
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await req('GET', `/products/${pid}`)).data.data.current_stock, 50);
  });

  it('rejects transfers into a warehouse that does not exist', async () => {
    const product = await req('POST', '/products', {
      name: `Audit Ghost WH Item ${Date.now()}`, sku: `AGW-${Date.now()}`, purchase_price: 5, selling_price: 9, opening_stock: 20,
    });
    const pid = product.data.data.id;
    const warehouses = (await req('GET', '/warehouses')).data.data;

    const res = await req('POST', '/stock/transfers', {
      from_warehouse_id: warehouses[0].id,
      to_warehouse_id: 999999,
      items: [{ product_id: pid, quantity: 2 }],
    });
    // Previously succeeded and silently vaporised the transferred quantity.
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.code, 'ERR_NOT_FOUND');
    assert.strictEqual((await req('GET', `/products/${pid}`)).data.data.current_stock, 20);
  });

  it('rejects stock adjustments for a product that does not exist', async () => {
    const res = await req('POST', '/stock/adjustments', {
      items: [{ product_id: 999999, new_qty: 5 }],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.code, 'ERR_NOT_FOUND');
  });

  it('generates a PDF invoice including full company and customer details', async () => {
    const cust = await req('POST', '/customers', {
      name: 'PDF Customer',
      phone: '9876543210',
      address: '123 Market Road',
      city: 'Surat',
      state: 'Gujarat',
      pincode: '395006',
      gstin: '24AAAAA0000A1Z5',
    });
    assert.strictEqual(cust.status, 201);
    const prod = await req('POST', '/products', {
      name: 'PDF Product',
      sku: 'PDF-1',
      selling_price: 500,
      opening_stock: 10,
    });
    const sale = await req('POST', '/sales', {
      invoice_type: 'sale',
      customer_id: cust.data.data.id,
      status: 'completed',
      items: [{
        product_id: prod.data.data.id,
        product_name: 'PDF Product',
        quantity: 1,
        unit_price: 500,
      }],
      paid_amount: 500,
    });
    assert.strictEqual(sale.status, 201);
    const saleId = sale.data.data.id;

    const res = await fetch(`${baseUrl}/sales/${saleId}/pdf`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
    assert.ok(buf.length > 5000, 'must contain embedded font and invoice content');
  });

});
