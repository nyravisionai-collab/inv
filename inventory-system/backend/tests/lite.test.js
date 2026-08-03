/**
 * Lite client tests.
 *
 * Two jobs:
 *   1. Guard the static contract — the page, its ES5 scripts, the stylesheet
 *      and the bundled Gujarati fonts must all be served, and the scripts must
 *      stay parseable as ES5 (Windows Phone IE11 has no ES6 at all).
 *   2. Guard the API contract — every request shape the lite UI sends is
 *      exercised against the real server, including the grand-total mirror:
 *      paid_amount must equal the server's grandTotal rupee-for-rupee so cash
 *      bills come back payment_status "paid".
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
const liteDir = path.join(__dirname, '../public/lite');
let server;

async function req(method, urlPath, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${origin}${urlPath}`, opts);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}

/** Every .js file shipped in public/lite. */
function liteScripts() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.js')) out.push(full);
    }
  }(path.join(liteDir, 'js')));
  return out;
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

  /* ------------------------------ static ------------------------------ */
  it('serves the lite page over plain HTTP', async () => {
    const res = await req('GET', '/lite/');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.ok(res.data.includes('Inventory Lite'), 'page title marker');
    assert.ok(!res.data.includes('type="module"'), 'no ES modules for old browsers');
    assert.ok(res.data.includes('js/core.js'), 'core script referenced');
  });

  it('serves every script and stylesheet the page references', async () => {
    const page = (await req('GET', '/lite/')).data;
    const refs = [...page.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((href) => !/^https?:|^\/\//.test(href));
    assert.ok(refs.length >= 12, `expected the split assets, found ${refs.length}`);
    for (const ref of refs) {
      const res = await req('GET', `/lite/${ref}`);
      assert.strictEqual(res.status, 200, `${ref} should be served`);
    }
  });

  it('serves the bundled Gujarati fonts the stylesheet references', async () => {
    const css = (await req('GET', '/lite/css/lite.css')).data;
    assert.ok(css.includes('NotoGuj'), 'Gujarati face declared');
    const woff = await req('GET', '/lite/fonts/noto-sans-gujarati-gujarati-400-normal.woff');
    assert.strictEqual(woff.status, 200);
    const woff2 = await req('GET', '/lite/fonts/noto-sans-gujarati-gujarati-700-normal.woff2');
    assert.strictEqual(woff2.status, 200);
  });

  it('keeps every lite script parseable as strict ES5', () => {
    // acorn ships with eslint, which is already a dev dependency.
    const acorn = require('acorn');
    const files = liteScripts();
    assert.ok(files.length >= 10, 'lite scripts present');
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      assert.doesNotThrow(
        () => acorn.parse(src, { ecmaVersion: 5, sourceType: 'script' }),
        `${path.relative(liteDir, file)} must be valid ES5`
      );
    }
  });

  it('avoids runtime APIs that IE11 does not implement', () => {
    // These parse fine as ES5 but throw at runtime on the target handsets.
    const banned = [
      /\bfetch\s*\(/, /\bPromise\b/, /\.classList\b/, /\.dataset\b/,
      /Object\.assign\b/, /Array\.from\b/, /Number\.isFinite\b/,
      /\.includes\s*\(/, /\.startsWith\s*\(/, /\.endsWith\s*\(/,
    ];
    for (const file of liteScripts()) {
      // Strip comments so prose about the rules does not trip the check.
      const src = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const re of banned) {
        assert.ok(!re.test(src), `${path.relative(liteDir, file)} must not use ${re}`);
      }
    }
  });

  it('registers a screen for every menu destination', () => {
    // A menu entry with no screen is a dead end on a phone with no dev tools.
    const appSrc = fs.readFileSync(path.join(liteDir, 'js/app.js'), 'utf8');
    const routes = new Set([...appSrc.matchAll(/route:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]));
    assert.ok(routes.size > 25, `expected the full menu, found ${routes.size}`);

    const registered = new Set();
    for (const file of liteScripts()) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/L\.screens\.([a-zA-Z]+)\s*=/g)) registered.add(m[1]);
      for (const m of src.matchAll(/L\.screens\['([a-zA-Z]+)'\]\s*=/g)) registered.add(m[1]);
    }
    const missing = [...routes].filter((r) => !registered.has(r));
    assert.deepStrictEqual(missing, [], `menu routes without a screen: ${missing.join(', ')}`);
  });

  /* --------------------------- core workflow --------------------------- */
  it('supports the full lite workflow: item → adjust → cash bill → history', async () => {
    // Units feed the product form's dropdown
    const units = await req('GET', '/api/units');
    assert.strictEqual(units.status, 200);
    assert.ok(Array.isArray(units.data.data) && units.data.data.length > 0);

    // New item — same body the lite product form posts
    const created = await req('POST', '/api/products', {
      name: 'Lite Test Item',
      selling_price: 50,
      purchase_price: 30,
      opening_stock: 10,
      tax_rate: 18,
      tax_type: 'exclusive',
      min_stock: 2,
    });
    assert.strictEqual(created.status, 201);
    const pid = created.data.data.id;
    assert.ok(pid);

    // Search — same query the POS/stock screens send
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
    const list = await req('GET', '/api/sales?type=sale,pos&limit=15&page=1');
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

  /* --------------------- POS options beyond a cash sale ---------------- */
  it('bills a customer on credit and settles it with a payment', async () => {
    const customer = await req('POST', '/api/customers', { name: 'Lite Credit Customer', phone: '9800000001' });
    assert.strictEqual(customer.status, 201);
    const cid = customer.data.data.id;

    const search = await req('GET', '/api/products?limit=1&search=Lite%20Test');
    const pid = search.data.data[0].id;

    // Credit bill: paid_amount 0 — the "Credit" segment in the lite POS.
    const sale = await req('POST', '/api/sales', {
      invoice_type: 'pos',
      status: 'completed',
      customer_id: cid,
      items: [{ product_id: pid, product_name: 'Lite Test Item', quantity: 1, unit_price: 100, tax_rate: 0, tax_type: 'none' }],
      discount_type: 'amount',
      discount_value: 0,
      payment_mode: 'cash',
      paid_amount: 0,
    });
    assert.strictEqual(sale.status, 201);
    assert.strictEqual(sale.data.data.payment_status, 'unpaid');
    assert.strictEqual(sale.data.data.balance_amount, 100);

    // Ledger + outstanding, as the party screens read them
    const ledger = await req('GET', `/api/customers/${cid}/ledger`);
    assert.strictEqual(ledger.status, 200);
    assert.ok(ledger.data.data.entries.length >= 1);

    const outstanding = await req('GET', '/api/customers/outstanding');
    assert.ok(outstanding.data.data.some((c) => c.id === cid));

    // Record payment — the body the lite payment form sends
    const payment = await req('POST', '/api/payments', {
      payment_type: 'payment_in',
      party_type: 'customer',
      party_id: cid,
      amount: 100,
      payment_mode: 'cash',
    });
    assert.strictEqual(payment.status, 201);

    const after = await req('GET', `/api/sales/${sale.data.data.id}`);
    assert.strictEqual(after.data.data.payment_status, 'paid');
    assert.strictEqual(after.data.data.balance_amount, 0);
  });

  it('applies a bill-level percent discount exactly as the phone computes it', async () => {
    const search = await req('GET', '/api/products?limit=1&search=Lite%20Test');
    const pid = search.data.data[0].id;
    // 1 × ₹200 @ 18% exclusive, 10% bill discount.
    // Taxable 200 - 20 = 180 → tax 32.40 → grand total 212.40.
    const sale = await req('POST', '/api/sales', {
      invoice_type: 'pos',
      status: 'completed',
      items: [{ product_id: pid, product_name: 'Lite Test Item', quantity: 1, unit_price: 200, tax_rate: 18, tax_type: 'exclusive' }],
      discount_type: 'percent',
      discount_value: 10,
      payment_mode: 'cash',
      paid_amount: 212.4,
    });
    assert.strictEqual(sale.status, 201);
    assert.strictEqual(sale.data.data.grand_total, 212.4);
    assert.strictEqual(sale.data.data.payment_status, 'paid');
  });

  it('handles a tax-inclusive (MRP) line without adding tax twice', async () => {
    const created = await req('POST', '/api/products', {
      name: 'Lite MRP Item', selling_price: 118, purchase_price: 80,
      opening_stock: 5, tax_rate: 18, tax_type: 'inclusive',
    });
    assert.strictEqual(created.status, 201);
    const sale = await req('POST', '/api/sales', {
      invoice_type: 'pos',
      status: 'completed',
      items: [{ product_id: created.data.data.id, quantity: 1, unit_price: 118, tax_rate: 18, tax_type: 'inclusive' }],
      paid_amount: 118,
    });
    assert.strictEqual(sale.status, 201);
    assert.strictEqual(sale.data.data.grand_total, 118);
    assert.strictEqual(sale.data.data.tax_amount, 18);
  });

  /* --------------------------- other documents ------------------------- */
  it('creates an estimate and converts it into a sale invoice', async () => {
    const search = await req('GET', '/api/products?limit=1&search=Lite%20Test');
    const pid = search.data.data[0].id;

    const estimate = await req('POST', '/api/sales', {
      invoice_type: 'estimate',
      status: 'completed',
      items: [{ product_id: pid, product_name: 'Lite Test Item', quantity: 1, unit_price: 60, tax_rate: 0, tax_type: 'none' }],
      paid_amount: 0,
    });
    assert.strictEqual(estimate.status, 201);

    const listed = await req('GET', '/api/sales?type=estimate&limit=15&page=1');
    assert.ok(listed.data.data.some((s) => s.id === estimate.data.data.id));

    const converted = await req('POST', `/api/sales/${estimate.data.data.id}/convert`, { to_type: 'sale' });
    assert.strictEqual(converted.status, 201);
    assert.strictEqual(converted.data.data.invoice_type, 'sale');
  });

  it('creates a purchase bill against a supplier and raises stock', async () => {
    const supplier = await req('POST', '/api/suppliers', { name: 'Lite Supplier', phone: '9800000002' });
    assert.strictEqual(supplier.status, 201);

    const before = await req('GET', '/api/products?limit=1&search=Lite%20Test');
    const pid = before.data.data[0].id;
    const beforeQty = Number(before.data.data[0].current_stock);

    // The exact body the lite purchase form posts, batch fields included.
    const purchase = await req('POST', '/api/purchases', {
      bill_type: 'purchase',
      status: 'completed',
      supplier_id: supplier.data.data.id,
      items: [{
        product_id: pid, product_name: 'Lite Test Item', quantity: 5,
        unit_price: 32, tax_rate: 18, tax_type: 'exclusive',
        batch_number: 'LITE-B1',
      }],
      discount_type: 'amount',
      discount_value: 0,
      payment_mode: 'cash',
      paid_amount: 0,
    });
    assert.strictEqual(purchase.status, 201);
    assert.strictEqual(purchase.data.data.payment_status, 'unpaid');

    const after = await req('GET', `/api/products/${pid}`);
    assert.strictEqual(Number(after.data.data.current_stock), beforeQty + 5);

    const bills = await req('GET', '/api/purchases?type=purchase&limit=15&page=1');
    assert.ok(bills.data.data.some((p) => p.id === purchase.data.data.id));
  });

  it('cancels a bill and puts the stock back', async () => {
    const search = await req('GET', '/api/products?limit=1&search=Lite%20Test');
    const pid = search.data.data[0].id;
    const startQty = Number(search.data.data[0].current_stock);

    const sale = await req('POST', '/api/sales', {
      invoice_type: 'pos',
      status: 'completed',
      items: [{ product_id: pid, product_name: 'Lite Test Item', quantity: 2, unit_price: 10, tax_rate: 0, tax_type: 'none' }],
      paid_amount: 20,
    });
    assert.strictEqual(sale.status, 201);

    const cancelled = await req('POST', `/api/sales/${sale.data.data.id}/cancel`);
    assert.strictEqual(cancelled.status, 200);

    const after = await req('GET', `/api/products/${pid}`);
    assert.strictEqual(Number(after.data.data.current_stock), startQty);
  });

  /* ------------------------------ the rest ----------------------------- */
  it('serves every screen the lite menu links to', async () => {
    // One GET per read-only screen: a 404/500 here is a blank page on the phone.
    const endpoints = [
      '/api/dashboard',
      '/api/settings',
      '/api/notifications',
      '/api/search?q=Lite',
      '/api/products?limit=5',
      '/api/products/low-stock',
      '/api/products/barcodes/all',
      '/api/categories', '/api/brands', '/api/units', '/api/warehouses',
      '/api/stock/report', '/api/stock/transfers', '/api/stock/adjustments',
      '/api/customers?limit=5', '/api/suppliers?limit=5',
      '/api/customers/outstanding', '/api/suppliers/outstanding',
      '/api/sales?type=sale,pos&limit=5', '/api/sales?type=estimate&limit=5',
      '/api/sales?type=sale_order&limit=5', '/api/sales?type=delivery_challan&limit=5',
      '/api/sales?type=sale_return&limit=5',
      '/api/purchases?type=purchase&limit=5', '/api/purchases?type=purchase_order&limit=5',
      '/api/purchases?type=purchase_return&limit=5',
      '/api/payments?type=payment_in&limit=5', '/api/payments?type=payment_out&limit=5',
      '/api/expenses?limit=5', '/api/incomes?limit=5', '/api/banks',
      '/api/cash-book', '/api/journals',
      '/api/reports/profit-loss', '/api/reports/balance-sheet', '/api/reports/gst',
      '/api/reports/sales', '/api/reports/purchases', '/api/reports/expenses',
      '/api/reports/stock', '/api/reports/customers', '/api/reports/suppliers',
      '/api/reports/outstanding', '/api/reports/product-profit',
      '/api/reports/customer-profit', '/api/reports/expiry',
      '/api/reports/warehouse-stock',
      '/api/users?limit=5', '/api/audit-logs?limit=5',
      '/api/tax-rates', '/api/backups', '/api/exports',
    ];
    for (const endpoint of endpoints) {
      const res = await req('GET', endpoint);
      assert.strictEqual(res.status, 200, `${endpoint} → ${res.status}`);
      assert.strictEqual(res.data.success, true, `${endpoint} should succeed`);
    }
  });

  it('records an expense and reflects it in the cash book', async () => {
    const expense = await req('POST', '/api/expenses', {
      category: 'Transport', amount: 250, payment_mode: 'cash', description: 'lite test',
    });
    assert.strictEqual(expense.status, 201);

    const book = await req('GET', '/api/cash-book');
    assert.strictEqual(book.status, 200);
    assert.ok(book.data.data.entries.some((e) => e.ref === expense.data.data.expense_number));
  });

  it('posts a balanced journal entry', async () => {
    const journal = await req('POST', '/api/journals', {
      narration: 'lite test entry',
      lines: [
        { account_name: 'Opening Stock', debit: 500, credit: 0 },
        { account_name: 'Capital', debit: 0, credit: 500 },
      ],
    });
    assert.strictEqual(journal.status, 201);
    assert.strictEqual(journal.data.data.total_debit, 500);
  });

  it('rejects an unbalanced journal with the code the lite UI translates', async () => {
    const journal = await req('POST', '/api/journals', {
      lines: [
        { account_name: 'A', debit: 100, credit: 0 },
        { account_name: 'B', debit: 0, credit: 40 },
      ],
    });
    assert.strictEqual(journal.status, 400);
    assert.strictEqual(journal.data.code, 'ERR_UNBALANCED');
  });

  it('saves a report PDF from the lite reports screen', async () => {
    const res = await req('POST', '/api/reports/profit-loss/pdf?from_date=2020-01-01&to_date=2099-12-31');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.data.fileName, 'a file name is returned');
  });

  it('generates the WhatsApp reminder link the party screen opens', async () => {
    const customers = await req('GET', '/api/customers?limit=1&search=Lite%20Credit');
    const cid = customers.data.data[0].id;
    const res = await req('POST', `/api/customers/${cid}/remind`);
    assert.strictEqual(res.status, 200);
    assert.match(res.data.data.link, /^https:\/\/wa\.me\//);
  });
});
