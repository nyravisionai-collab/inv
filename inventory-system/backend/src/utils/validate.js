/**
 * Lightweight validation helpers.
 *
 * Every failure throws a `ValidationError`, which carries an HTTP status and a
 * stable machine-readable `code` so the frontend can translate the message
 * instead of showing raw English text.
 */

class ValidationError extends Error {
  constructor(message, code = 'ERR_VALIDATION', status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.status = status;
  }
}

function fail(message, code) {
  throw new ValidationError(message, code);
}

/** Finite number, rejects NaN/Infinity/"12abc". */
function toNumber(value, field, { min = null, max = null, allowNull = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowNull) return null;
    fail(`${field} is required`, 'ERR_REQUIRED');
  }
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${field} must be a valid number`, 'ERR_NOT_NUMBER');
  if (min !== null && n < min) fail(`${field} must be at least ${min}`, 'ERR_TOO_SMALL');
  if (max !== null && n > max) fail(`${field} must be at most ${max}`, 'ERR_TOO_LARGE');
  return n;
}

function requireNonEmpty(value, field) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (!s) fail(`${field} is required`, 'ERR_REQUIRED');
  return s;
}

function requireArray(value, field, { min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail(`${field} must contain at least ${min} item(s)`, 'ERR_EMPTY_LIST');
  }
  return value;
}

function oneOf(value, allowed, field, fallback = undefined) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    fail(`${field} is required`, 'ERR_REQUIRED');
  }
  if (!allowed.includes(value)) {
    fail(`${field} must be one of: ${allowed.join(', ')}`, 'ERR_INVALID_ENUM');
  }
  return value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts YYYY-MM-DD and verifies it is a real calendar date. */
function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).slice(0, 10);
  if (!DATE_RE.test(s)) fail(`${field} must be in YYYY-MM-DD format`, 'ERR_INVALID_DATE');
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    fail(`${field} is not a real date`, 'ERR_INVALID_DATE');
  }
  return s;
}

/** Clamp pagination so metadata echoed back to the client is always sane. */
function pageParams(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const rawPage = parseInt(query.page, 10);
  const rawLimit = parseInt(query.limit, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(maxLimit, rawLimit) : defaultLimit;
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Validate a single invoice/bill line.
 * Guards against the negative quantity + negative price combination that
 * previously produced a positive grand total.
 */
function validateLineItem(item, index, { requireName = true } = {}) {
  const label = `Item ${index + 1}`;
  if (!item || typeof item !== 'object') fail(`${label} is invalid`, 'ERR_INVALID_ITEM');

  const name = item.product_name || item.name;
  if (requireName && !String(name || '').trim() && !item.product_id) {
    fail(`${label}: product name or product is required`, 'ERR_ITEM_NAME');
  }

  const quantity = toNumber(item.quantity, `${label} quantity`, { min: 0 });
  if (quantity <= 0) fail(`${label}: quantity must be greater than zero`, 'ERR_QTY_POSITIVE');

  const unitPrice = toNumber(item.unit_price ?? 0, `${label} price`, { min: 0 });
  const discountType = oneOf(item.discount_type, ['amount', 'percent'], `${label} discount type`, 'amount');
  const discountValue = toNumber(item.discount_value ?? 0, `${label} discount`, { min: 0 });

  const lineSubtotal = quantity * unitPrice;
  if (discountType === 'percent') {
    if (discountValue > 100) fail(`${label}: discount cannot exceed 100%`, 'ERR_DISCOUNT_RANGE');
  } else if (discountValue > lineSubtotal) {
    fail(`${label}: discount cannot exceed the line total`, 'ERR_DISCOUNT_RANGE');
  }

  const taxRate = toNumber(item.tax_rate ?? 0, `${label} tax rate`, { min: 0, max: 100 });
  const taxType = oneOf(item.tax_type, ['inclusive', 'exclusive', 'none'], `${label} tax type`, 'exclusive');

  return { quantity, unitPrice, discountType, discountValue, taxRate, taxType };
}

/** Validate document-level monetary fields shared by sales and purchases. */
function validateDocumentTotals(body) {
  const discountType = oneOf(body.discount_type, ['amount', 'percent'], 'Discount type', 'amount');
  const discountValue = toNumber(body.discount_value ?? 0, 'Discount', { min: 0 });
  if (discountType === 'percent' && discountValue > 100) {
    fail('Discount cannot exceed 100%', 'ERR_DISCOUNT_RANGE');
  }
  return {
    discountType,
    discountValue,
    shippingCharges: toNumber(body.shipping_charges ?? 0, 'Shipping charges', { min: 0 }),
    otherCharges: toNumber(body.other_charges ?? 0, 'Other charges', { min: 0 }),
    roundOff: toNumber(body.round_off ?? 0, 'Round off', { min: -1, max: 1 }),
    paidAmount: toNumber(body.paid_amount ?? 0, 'Paid amount', { min: 0 }),
  };
}

module.exports = {
  ValidationError,
  fail,
  toNumber,
  requireNonEmpty,
  requireArray,
  oneOf,
  optionalDate,
  pageParams,
  validateLineItem,
  validateDocumentTotals,
};
