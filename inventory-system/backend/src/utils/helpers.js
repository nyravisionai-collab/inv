const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Format `date` in the configured business timezone.
 *
 * Previously a hard-coded +5:30 offset was applied, which produced wrong dates
 * for any deployment outside India and ignored the TIMEZONE setting entirely.
 * Intl handles the offset and DST correctly for whatever zone is configured.
 */
function zonedParts(date = new Date()) {
  const timeZone = config.timezone || 'Asia/Kolkata';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date);
  } catch {
    // Unknown timezone in the config: fall back to the system zone.
    parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date);
  }
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  // Intl can emit "24" for midnight in some environments.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour, minute: get('minute'), second: get('second'),
  };
}

function today(date = new Date()) {
  const p = zonedParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function now(date = new Date()) {
  const p = zonedParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function generateNumber(prefix, nextNum, pad = 5) {
  return `${prefix}-${String(nextNum).padStart(pad, '0')}`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function moneyError(message, code = 'ERR_VALIDATION') {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

/**
 * Calculate one invoice line.
 *
 * `taxType` controls how `taxRate` relates to `price`:
 *   - 'exclusive' (default): tax is added on top of the discounted amount.
 *   - 'inclusive': the price already contains the tax, so the tax portion is
 *     extracted from it. This is how MRP-based retail pricing works in India.
 *   - 'none': no tax is applied.
 *
 * `taxableAmount` is the pre-tax value of the line and is what GST reports and
 * the invoice subtotal should be based on.
 */
function calcLineTotal(qty, price, discountType, discountValue, taxRate = 0, taxType = 'none') {
  const quantity = Number(qty) || 0;
  const unitPrice = Number(price) || 0;
  // taxRate and taxType are ignored now as per user request to remove taxes.
  const rate = 0;
  const tType = 'none';

  const gross = quantity * unitPrice;

  let discountAmount;
  if (discountType === 'percent') {
    discountAmount = round2(gross * (Number(discountValue) || 0) / 100);
  } else {
    discountAmount = Number(discountValue) || 0;
  }

  const afterDiscount = gross - discountAmount;

  const taxableAmount = round2(afterDiscount);
  const taxAmount = 0;
  const total = round2(afterDiscount);

  return {
    subtotal: round2(gross),
    discountAmount: round2(discountAmount),
    taxableAmount,
    taxAmount,
    total,
  };
}

/**
 * Aggregate line results into invoice totals.
 *
 * For tax-inclusive lines the tax is already contained in the line total, so
 * it must not be added again. Summing each line's `total` (rather than
 * re-deriving it) keeps both tax modes correct, and mixed-mode invoices too.
 */
function invoiceDiscountBase(item) {
  const taxType = item.tax_type || item.taxType || 'exclusive';
  if (taxType === 'inclusive') return Math.max(0, Number(item.total || 0));
  if (item.taxable_amount !== undefined) return Math.max(0, Number(item.taxable_amount || 0));
  if (item.taxableAmount !== undefined) return Math.max(0, Number(item.taxableAmount || 0));
  return Math.max(0, Number(item.total || 0) - Number(item.tax_amount || item.taxAmount || 0));
}

function allocateProportionally(amount, bases) {
  const totalBase = bases.reduce((s, b) => s + Number(b || 0), 0);
  const target = round2(amount);
  if (target <= 0 || totalBase <= 0) return bases.map(() => 0);

  const out = [];
  let allocated = 0;
  let lastPositive = -1;
  bases.forEach((b, i) => { if (Number(b || 0) > 0) lastPositive = i; });

  for (let i = 0; i < bases.length; i++) {
    if (Number(bases[i] || 0) <= 0) {
      out.push(0);
      continue;
    }
    let share;
    if (i === lastPositive) share = round2(target - allocated);
    else share = round2(target * Number(bases[i]) / totalBase);
    allocated = round2(allocated + share);
    out.push(share);
  }
  return out;
}

/**
 * Aggregate line results into invoice totals and allocate any bill-level
 * discount back onto the lines.
 *
 * GST discounts reduce taxable value before tax. Older code subtracted the
 * invoice discount after tax, which overstated GST and the grand total. This
 * function therefore prorates a bill discount over each line's post line-level
 * discount base, recomputes taxable/tax/line total, and stores the allocated
 * slice in `invoice_discount_amount`.
 */
function calcInvoiceTotals(items, discountType, discountValue, shipping = 0, other = 0, roundOff = 0) {
  let gross = 0;
  let lineDiscount = 0;

  for (const item of items) {
    const qty = Number(item.quantity || 0);
    const price = Number(item.unit_price || 0);
    gross += qty * price;
    const originalLineDiscount = item.line_discount_amount !== undefined
      ? Number(item.line_discount_amount || 0)
      : Number(item.discount_amount || 0);
    item.line_discount_amount = round2(originalLineDiscount);
    lineDiscount += item.line_discount_amount;
  }

  const subtotal = round2(gross);
  lineDiscount = round2(lineDiscount);

  const bases = items.map(invoiceDiscountBase);
  const discountBase = round2(bases.reduce((s, b) => s + Number(b || 0), 0));
  let invoiceDiscount;
  if (discountType === 'percent') {
    invoiceDiscount = round2(discountBase * (Number(discountValue) || 0) / 100);
  } else {
    invoiceDiscount = round2(Number(discountValue) || 0);
  }

  if (invoiceDiscount > discountBase + 0.009) {
    throw moneyError('Discount cannot exceed the invoice total', 'ERR_DISCOUNT_RANGE');
  }

  const allocations = allocateProportionally(invoiceDiscount, bases);

  let taxAmount = 0;
  let lineTotals = 0;
  let allocatedInvoiceDiscount = 0;

  items.forEach((item, index) => {
    // Tax is disabled
    const taxType = 'none';
    const rate = 0;
    const alloc = round2(allocations[index] || 0);
    allocatedInvoiceDiscount = round2(allocatedInvoiceDiscount + alloc);
    item.invoice_discount_amount = alloc;
    item.discount_amount = round2(Number(item.line_discount_amount || 0) + alloc);

    const taxableAmount = round2(Math.max(0, invoiceDiscountBase(item) - alloc));
    const lineTax = 0;
    const total = taxableAmount;

    item.tax_type = taxType;
    item.tax_rate = 0;
    item.taxable_amount = taxableAmount;
    item.tax_amount = lineTax;
    item.total = total;

    taxAmount = 0;
    lineTotals = round2(lineTotals + total);
  });

  const discountAmount = round2(lineDiscount + allocatedInvoiceDiscount);
  const grandTotal = round2(
    lineTotals + Number(shipping || 0) + Number(other || 0) + Number(roundOff || 0)
  );

  if (grandTotal < -0.009) {
    throw moneyError('Grand total cannot be negative', 'ERR_TOTAL_NEGATIVE');
  }

  return { subtotal, discountAmount, taxAmount, grandTotal: Math.max(0, grandTotal) };
}

function paginate(query, params = {}, page = 1, limit = 20) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * l;
  return { sql: `${query} LIMIT ? OFFSET ?`, params: [...(Array.isArray(params) ? params : []), l, offset], page: p, limit: l };
}

function safeJson(str, fallback = {}) {
  try {
    return typeof str === 'string' ? JSON.parse(str) : (str || fallback);
  } catch {
    return fallback;
  }
}

function uuid() {
  return uuidv4();
}

/**
 * Escape LIKE wildcards so a user searching for "Rice_50kg" does not match
 * "Rice X 50kg". Must be paired with `ESCAPE '!'` in the SQL statement.
 *
 * '!' is used rather than a backslash because SQLite does not treat the
 * backslash as an escape character inside string literals, and doubling it
 * through the JavaScript layer is easy to get wrong.
 */
const LIKE_ESCAPE_CHAR = '!';

function sanitizeLike(str) {
  return String(str || '').replace(/[!%_]/g, `${LIKE_ESCAPE_CHAR}$&`);
}

module.exports = {
  today, now, generateNumber, round2, calcLineTotal, calcInvoiceTotals,
  paginate, safeJson, uuid, sanitizeLike, LIKE_ESCAPE_CHAR,
};
