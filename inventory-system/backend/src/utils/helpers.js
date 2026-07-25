const { v4: uuidv4 } = require('uuid');

function today() {
  const d = new Date();
  const offset = 5.5 * 60;
  const local = new Date(d.getTime() + offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function now() {
  const d = new Date();
  const offset = 5.5 * 60;
  const local = new Date(d.getTime() + offset * 60 * 1000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

function generateNumber(prefix, nextNum, pad = 5) {
  return `${prefix}-${String(nextNum).padStart(pad, '0')}`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function calcLineTotal(qty, price, discountType, discountValue, taxRate) {
  const quantity = Number(qty) || 0;
  const unitPrice = Number(price) || 0;
  let subtotal = quantity * unitPrice;
  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = round2(subtotal * (Number(discountValue) || 0) / 100);
  } else {
    discountAmount = Number(discountValue) || 0;
  }
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = round2(afterDiscount * (Number(taxRate) || 0) / 100);
  const total = round2(afterDiscount + taxAmount);
  return { subtotal: round2(subtotal), discountAmount: round2(discountAmount), taxAmount, total };
}

function calcInvoiceTotals(items, discountType, discountValue, shipping = 0, other = 0, roundOff = 0) {
  let subtotal = 0;
  let taxAmount = 0;
  let itemDiscount = 0;
  for (const item of items) {
    subtotal += Number(item.unit_price || 0) * Number(item.quantity || 0);
    taxAmount += Number(item.tax_amount || 0);
    itemDiscount += Number(item.discount_amount || 0);
  }
  subtotal = round2(subtotal);
  taxAmount = round2(taxAmount);
  itemDiscount = round2(itemDiscount);

  let invoiceDiscount = 0;
  const afterItemDiscount = subtotal - itemDiscount;
  if (discountType === 'percent') {
    invoiceDiscount = round2(afterItemDiscount * (Number(discountValue) || 0) / 100);
  } else {
    invoiceDiscount = Number(discountValue) || 0;
  }

  const discountAmount = round2(itemDiscount + invoiceDiscount);
  const grandTotal = round2(subtotal - discountAmount + taxAmount + Number(shipping || 0) + Number(other || 0) + Number(roundOff || 0));
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

function sanitizeLike(str) {
  return String(str || '').replace(/[%_\\]/g, '\\$&');
}

module.exports = {
  today, now, generateNumber, round2, calcLineTotal, calcInvoiceTotals,
  paginate, safeJson, uuid, sanitizeLike,
};
