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
function calcLineTotal(qty, price, discountType, discountValue, taxRate, taxType = 'exclusive') {
  const quantity = Number(qty) || 0;
  const unitPrice = Number(price) || 0;
  const rate = Number(taxRate) || 0;

  const gross = quantity * unitPrice;

  let discountAmount;
  if (discountType === 'percent') {
    discountAmount = round2(gross * (Number(discountValue) || 0) / 100);
  } else {
    discountAmount = Number(discountValue) || 0;
  }

  const afterDiscount = gross - discountAmount;

  let taxableAmount;
  let taxAmount;
  let total;

  if (taxType === 'none' || rate === 0) {
    taxableAmount = round2(afterDiscount);
    taxAmount = 0;
    total = round2(afterDiscount);
  } else if (taxType === 'inclusive') {
    // afterDiscount already includes tax: back it out.
    taxableAmount = round2(afterDiscount / (1 + rate / 100));
    taxAmount = round2(afterDiscount - taxableAmount);
    total = round2(afterDiscount);
  } else {
    taxableAmount = round2(afterDiscount);
    taxAmount = round2(afterDiscount * rate / 100);
    total = round2(afterDiscount + taxAmount);
  }

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
function calcInvoiceTotals(items, discountType, discountValue, shipping = 0, other = 0, roundOff = 0) {
  let gross = 0;
  let taxAmount = 0;
  let itemDiscount = 0;
  let lineTotals = 0;

  for (const item of items) {
    gross += Number(item.unit_price || 0) * Number(item.quantity || 0);
    taxAmount += Number(item.tax_amount || 0);
    itemDiscount += Number(item.discount_amount || 0);
    lineTotals += Number(item.total || 0);
  }

  const subtotal = round2(gross);
  taxAmount = round2(taxAmount);
  itemDiscount = round2(itemDiscount);
  lineTotals = round2(lineTotals);

  let invoiceDiscount;
  const afterItemDiscount = subtotal - itemDiscount;
  if (discountType === 'percent') {
    invoiceDiscount = round2(afterItemDiscount * (Number(discountValue) || 0) / 100);
  } else {
    invoiceDiscount = Number(discountValue) || 0;
  }

  const discountAmount = round2(itemDiscount + invoiceDiscount);
  const grandTotal = round2(
    lineTotals - invoiceDiscount
    + Number(shipping || 0) + Number(other || 0) + Number(roundOff || 0)
  );

  return { subtotal, discountAmount, taxAmount, grandTotal };
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
