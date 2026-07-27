/**
 * Unit tests for the pure helpers.
 *
 * These cover the money maths, validation guards, LIKE escaping, redaction and
 * the XLSX round-trip — the logic where a silent regression would corrupt
 * business data rather than throw a visible error.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  round2, calcLineTotal, calcInvoiceTotals, sanitizeLike, generateNumber, safeJson,
} = require('../src/utils/helpers');
const {
  ValidationError, toNumber, requireArray, oneOf, optionalDate,
  pageParams, validateLineItem, validateDocumentTotals,
} = require('../src/utils/validate');
const { redact, stripTags, sanitizeDeep, csvCell } = require('../src/utils/sanitize');
const { readSheet, writeSheet } = require('../src/utils/xlsx');
const {
  normalizeIp,
  isLocalOrLanAddress,
  getEffectiveClientIp,
} = require('../src/middleware/networkAccess');

describe('helpers: money maths', () => {
  it('round2 handles floating point drift', () => {
    assert.strictEqual(round2(0.1 + 0.2), 0.3);
    assert.strictEqual(round2('12.344'), 12.34);
    assert.strictEqual(round2(12.345), 12.35);
    assert.strictEqual(round2(undefined), 0);
    // 1.005 is really 1.00499... in binary floating point, so it rounds down.
    // Asserting the actual behaviour documents the known limitation.
    assert.strictEqual(round2(1.005), 1);
  });

  it('exclusive tax adds on top of the discounted amount', () => {
    const r = calcLineTotal(2, 100, 'amount', 0, 18, 'exclusive');
    assert.strictEqual(r.taxableAmount, 200);
    assert.strictEqual(r.taxAmount, 36);
    assert.strictEqual(r.total, 236);
  });

  it('inclusive tax is extracted from the price', () => {
    const r = calcLineTotal(1, 118, 'amount', 0, 18, 'inclusive');
    assert.strictEqual(r.taxableAmount, 100);
    assert.strictEqual(r.taxAmount, 18);
    assert.strictEqual(r.total, 118, 'inclusive total must equal the MRP');
  });

  it('tax type none charges no tax', () => {
    const r = calcLineTotal(3, 50, 'amount', 0, 18, 'none');
    assert.strictEqual(r.taxAmount, 0);
    assert.strictEqual(r.total, 150);
  });

  it('percent discount is applied before tax', () => {
    const r = calcLineTotal(1, 200, 'percent', 10, 10, 'exclusive');
    assert.strictEqual(r.discountAmount, 20);
    assert.strictEqual(r.taxableAmount, 180);
    assert.strictEqual(r.taxAmount, 18);
    assert.strictEqual(r.total, 198);
  });

  it('invoice totals do not double-count inclusive tax', () => {
    const line = calcLineTotal(2, 118, 'amount', 0, 18, 'inclusive');
    const items = [{
      unit_price: 118, quantity: 2, tax_rate: 18, tax_type: 'inclusive',
      taxable_amount: line.taxableAmount, tax_amount: line.taxAmount,
      discount_amount: line.discountAmount, total: line.total,
    }];
    const totals = calcInvoiceTotals(items, 'amount', 0);
    assert.strictEqual(totals.grandTotal, 236);
    assert.strictEqual(totals.taxAmount, 36);
  });

  it('invoice-level charges and discount apply to the grand total', () => {
    const line = calcLineTotal(1, 100, 'amount', 0, 0, 'none');
    const items = [{
      unit_price: 100, quantity: 1, tax_rate: 0, tax_type: 'none',
      taxable_amount: line.taxableAmount, tax_amount: 0,
      discount_amount: 0, total: line.total,
    }];
    const totals = calcInvoiceTotals(items, 'amount', 10, 25, 5, 0.4);
    // 100 - 10 discount + 25 shipping + 5 other + 0.40 round-off
    assert.strictEqual(totals.grandTotal, 120.4);
  });


  it('invoice-level discount reduces taxable value before tax', () => {
    const line = calcLineTotal(1, 100, 'amount', 0, 18, 'exclusive');
    const items = [{
      unit_price: 100, quantity: 1, tax_rate: 18, tax_type: 'exclusive',
      taxable_amount: line.taxableAmount, tax_amount: line.taxAmount,
      discount_amount: line.discountAmount, total: line.total,
    }];
    const totals = calcInvoiceTotals(items, 'amount', 10);
    assert.strictEqual(items[0].taxable_amount, 90);
    assert.strictEqual(items[0].tax_amount, 16.2);
    assert.strictEqual(totals.taxAmount, 16.2);
    assert.strictEqual(totals.grandTotal, 106.2);
  });
});

describe('helpers: misc', () => {
  it('sanitizeLike escapes wildcards with the ! escape char', () => {
    assert.strictEqual(sanitizeLike('Rice_50'), 'Rice!_50');
    assert.strictEqual(sanitizeLike('100%'), '100!%');
    assert.strictEqual(sanitizeLike('a!b'), 'a!!b');
    assert.strictEqual(sanitizeLike(null), '');
  });

  it('generateNumber zero-pads', () => {
    assert.strictEqual(generateNumber('INV', 7), 'INV-00007');
    assert.strictEqual(generateNumber('PO', 12345), 'PO-12345');
  });

  it('safeJson falls back instead of throwing', () => {
    assert.deepStrictEqual(safeJson('{"a":1}'), { a: 1 });
    assert.deepStrictEqual(safeJson('not json'), {});
    assert.deepStrictEqual(safeJson('bad', { x: 1 }), { x: 1 });
  });
});

describe('validate', () => {
  it('rejects non-numeric and out-of-range values', () => {
    assert.throws(() => toNumber('abc', 'Qty'), ValidationError);
    assert.throws(() => toNumber(-1, 'Qty', { min: 0 }), /at least/);
    assert.throws(() => toNumber(Infinity, 'Qty'), /valid number/);
    assert.strictEqual(toNumber('12.5', 'Qty'), 12.5);
    assert.strictEqual(toNumber('', 'Qty', { allowNull: true }), null);
  });

  it('rejects an empty item list', () => {
    assert.throws(() => requireArray([], 'Items'), /at least/);
    assert.throws(() => requireArray(undefined, 'Items'), ValidationError);
  });

  it('oneOf enforces the allow-list but honours a fallback', () => {
    assert.strictEqual(oneOf(undefined, ['a', 'b'], 'Type', 'a'), 'a');
    assert.strictEqual(oneOf('b', ['a', 'b'], 'Type'), 'b');
    assert.throws(() => oneOf('z', ['a', 'b'], 'Type'), /one of/);
  });

  it('optionalDate rejects impossible calendar dates', () => {
    assert.strictEqual(optionalDate('2026-02-28', 'Date'), '2026-02-28');
    assert.strictEqual(optionalDate('', 'Date'), null);
    assert.throws(() => optionalDate('2026-02-30', 'Date'), /real date/);
    assert.throws(() => optionalDate('26-01-2026', 'Date'), /YYYY-MM-DD/);
  });

  it('pageParams clamps hostile pagination input', () => {
    assert.deepStrictEqual(pageParams({ page: -5, limit: 20 }), { page: 1, limit: 20, offset: 0 });
    assert.deepStrictEqual(pageParams({ page: 3, limit: 99999 }), { page: 3, limit: 100, offset: 200 });
    assert.deepStrictEqual(pageParams({}), { page: 1, limit: 20, offset: 0 });
  });

  it('line items must have a positive quantity and non-negative price', () => {
    const named = (extra) => ({ product_name: 'Item', ...extra });
    assert.throws(() => validateLineItem(named({ quantity: 0, unit_price: 10 }), 0), /greater than zero/);
    assert.throws(() => validateLineItem(named({ quantity: -5, unit_price: 10 }), 0), ValidationError);
    assert.throws(() => validateLineItem(named({ quantity: 1, unit_price: -10 }), 0), ValidationError);
    // A line with neither a name nor a product id is rejected too.
    assert.throws(() => validateLineItem({ quantity: 1, unit_price: 10 }, 0), /name or product/);
    const ok = validateLineItem(named({ quantity: 2, unit_price: 50, tax_rate: 5 }), 0);
    assert.strictEqual(ok.quantity, 2);
    assert.strictEqual(ok.taxType, 'exclusive');
  });

  it('line discount cannot exceed the line value', () => {
    assert.throws(
      () => validateLineItem({ product_name: 'I', quantity: 1, unit_price: 100, discount_value: 150 }, 0),
      /exceed/
    );
    assert.throws(
      () => validateLineItem({ product_name: 'I', quantity: 1, unit_price: 100, discount_type: 'percent', discount_value: 120 }, 0),
      /100%/
    );
  });

  it('document totals reject negative money', () => {
    assert.throws(() => validateDocumentTotals({ paid_amount: -1 }), ValidationError);
    assert.throws(() => validateDocumentTotals({ shipping_charges: -5 }), ValidationError);
    const ok = validateDocumentTotals({ paid_amount: 100, shipping_charges: 20 });
    assert.strictEqual(ok.paidAmount, 100);
    assert.strictEqual(ok.shippingCharges, 20);
  });
});

describe('sanitize', () => {
  it('redacts secrets at any depth', () => {
    const out = redact({
      username: 'u', password: 'hunter2',
      nested: { new_password: 'x', keep: 1 },
      list: [{ token: 'abc', name: 'ok' }],
    });
    assert.strictEqual(out.password, '[REDACTED]');
    assert.strictEqual(out.nested.new_password, '[REDACTED]');
    assert.strictEqual(out.list[0].token, '[REDACTED]');
    assert.strictEqual(out.username, 'u');
    assert.strictEqual(out.nested.keep, 1);
    assert.strictEqual(out.list[0].name, 'ok');
  });

  it('strips tags, event handlers and javascript: urls', () => {
    assert.strictEqual(stripTags('<script>bad</script>Item'), 'badItem');
    assert.strictEqual(stripTags('<img src=x onerror="alert(1)">'), '');
    assert.ok(!stripTags('<a href="javascript:alert(1)">x</a>').includes('javascript:'));
  });

  it('sanitizeDeep reaches strings inside arrays', () => {
    const body = { items: [{ product_name: '<b>Hi</b>' }], note: '<i>x</i>' };
    sanitizeDeep(body);
    assert.strictEqual(body.items[0].product_name, 'Hi');
    assert.strictEqual(body.note, 'x');
  });

  it('csvCell neutralises spreadsheet formulas', () => {
    assert.strictEqual(csvCell('=1+1'), "'=1+1");
    assert.strictEqual(csvCell('+cmd'), "'+cmd");
    assert.strictEqual(csvCell('@SUM'), "'@SUM");
    assert.strictEqual(csvCell('normal'), 'normal');
    assert.strictEqual(csvCell(42), 42);
  });
});

describe('network access guard', () => {
  it('normalizes IPv4-mapped IPv6 client addresses', () => {
    assert.strictEqual(normalizeIp('::ffff:192.168.1.15'), '192.168.1.15');
    assert.strictEqual(normalizeIp('[fe80::1%wlan0]'), 'fe80::1');
  });

  it('allows only local and private LAN ranges', () => {
    ['127.0.0.1', '10.0.0.5', '172.16.1.2', '172.31.255.1', '192.168.1.50', '169.254.1.1', '100.64.1.1', '::1', 'fd12::1', 'fe80::1'].forEach((ip) => {
      assert.strictEqual(isLocalOrLanAddress(ip), true, `${ip} should be allowed`);
    });
    ['8.8.8.8', '1.1.1.1', '172.32.0.1', '198.51.100.10', '2001:4860:4860::8888'].forEach((ip) => {
      assert.strictEqual(isLocalOrLanAddress(ip), false, `${ip} should be blocked`);
    });
  });

  it('trusts forwarded client IPs only from a loopback proxy', () => {
    assert.strictEqual(getEffectiveClientIp({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '8.8.8.8, 127.0.0.1' },
    }), '8.8.8.8');

    assert.strictEqual(getEffectiveClientIp({
      socket: { remoteAddress: '8.8.8.8' },
      headers: { 'x-forwarded-for': '192.168.1.5' },
    }), '8.8.8.8');
  });
});

describe('xlsx', () => {
  it('round-trips values, types and Unicode', () => {
    const rows = [
      { name: 'Rice_50kg', qty: 12.5, active: true, note: 'ગુજરાતી' },
      { name: 'A & B <c>', qty: 0, active: false, note: '' },
    ];
    const parsed = readSheet(writeSheet(rows, 'products'));
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].name, 'Rice_50kg');
    assert.strictEqual(parsed[0].qty, 12.5);
    assert.strictEqual(parsed[0].active, true);
    assert.strictEqual(parsed[0].note, 'ગુજરાતી');
    assert.strictEqual(parsed[1].name, 'A & B <c>');
    assert.strictEqual(parsed[1].active, false);
  });

  it('produces a real ZIP container', () => {
    const buf = writeSheet([{ a: 1 }], 'Sheet1');
    assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'must start with a local file header');
    assert.ok(buf.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  });

  it('handles an empty data set', () => {
    const parsed = readSheet(writeSheet([], 'empty'));
    assert.deepStrictEqual(parsed, []);
  });

  it('rejects a non-xlsx buffer instead of hanging', () => {
    assert.throws(() => readSheet(Buffer.from('not a zip at all')), /valid XLSX/);
  });
});

describe('pdf', () => {
  const { createPdfDocument, pdfMoney, splitByScript } = require('../src/utils/pdf');

  it('splits mixed Gujarati and Latin into runs', () => {
    const runs = splitByScript('બિલ INV-001 ₹250');
    assert.ok(runs.length >= 3);
    assert.strictEqual(runs[0].gujarati, true);
    assert.ok(runs.some((r) => !r.gujarati && r.text.includes('INV')));
    // The rupee sign only exists in the Gujarati subset.
    assert.ok(runs.some((r) => r.gujarati && r.text.includes('₹')));
  });

  it('treats pure ASCII as a single Latin run', () => {
    const runs = splitByScript('Invoice 12345');
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].gujarati, false);
  });

  it('handles empty input', () => {
    assert.deepStrictEqual(splitByScript(''), []);
    assert.deepStrictEqual(splitByScript(null), []);
  });

  it('registers distinct fonts so both scripts can render', () => {
    const { doc, unicode, regularFont, gujaratiFont } = createPdfDocument();
    if (unicode) {
      assert.notStrictEqual(regularFont, gujaratiFont,
        'Latin and Gujarati must be separate fonts');
    }
    doc.end();
  });

  it('produces a PDF containing both scripts', (t, done) => {
    const { doc, writeText, unicode } = createPdfDocument();
    if (!unicode) return done();
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      assert.ok(pdf.slice(0, 5).toString() === '%PDF-', 'must be a PDF');
      const text = pdf.toString('latin1');
      // Both subsets embedded under distinct names.
      assert.ok(text.includes('gujarati'), 'Gujarati font must be embedded');
      assert.ok(text.includes('latin'), 'Latin font must be embedded');
      done();
    });
    writeText('બિલ INV-001 ₹250.00');
    doc.end();
  });

  it('falls back to Rs. when unicode fonts are unavailable', () => {
    assert.strictEqual(pdfMoney(10, '₹', true), '₹10.00');
    assert.strictEqual(pdfMoney(10, '₹', false), 'Rs.10.00');
  });
});
