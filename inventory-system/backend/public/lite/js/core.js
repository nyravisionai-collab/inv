/**
 * Inventory Lite — core runtime: state, helpers, XHR API and money math.
 *
 * ES5 ONLY. No let/const, arrows, template literals, fetch, Promise,
 * classList, dataset, Array.prototype.find or Object.assign — this must run on
 * Windows Phone (IE11 Mobile), old Android stock browsers and pre-Chromium
 * Edge. Everything hangs off the single global `Lite`.
 */
window.Lite = (function () {
  'use strict';

  var STR = window.LITE_STR;

  /* ------------------------------- state ------------------------------- */
  var S = {
    lang: 'gu',
    route: { name: 'home', arg: null, arg2: null },
    stack: [],           // breadcrumb of routes, powers the header back button
    busy: false,
    settings: null,      // company settings (currency symbol, prefixes…)
    units: null,
    categories: null,
    brands: null,
    warehouses: null,
    banks: null,
    notifUnread: 0,
    data: {},            // per-screen scratch space, cleared on navigation
    draft: null          // the document being composed (sale/purchase)
  };

  try {
    var savedLang = window.localStorage.getItem('lite_lang');
    if (savedLang === 'en' || savedLang === 'gu') S.lang = savedLang;
  } catch (eLang) { /* private browsing throws on localStorage */ }

  function t(k) {
    var pack = STR[S.lang] || STR.en;
    if (pack[k] !== undefined) return pack[k];
    if (STR.en[k] !== undefined) return STR.en[k];
    return k;
  }

  /* ---------------------------- DOM helpers ---------------------------- */
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Escape for use inside a single-quoted inline JS attribute. */
  function jsq(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      .replace(/</g, '\\u003c').replace(/"/g, '&quot;')
      .replace(/[\r\n]/g, ' ');
  }

  function val(id) { var el = $(id); return el ? el.value : ''; }
  function trim(s) { return String(s === null || s === undefined ? '' : s).replace(/^\s+|\s+$/g, ''); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round2(n) { return Math.round(num(n) * 100) / 100; }
  function toInt(v) { var n = parseInt(v, 10); return isFinite(n) ? n : 0; }

  /** Array.prototype.find is ES6 — old engines need this. */
  function findBy(arr, key, value) {
    if (!arr) return null;
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i][key]) === String(value)) return arr[i];
    }
    return null;
  }

  /** Indian-style digit grouping: 1,23,456.78 */
  function fmt(n) {
    n = round2(n);
    var neg = n < 0;
    var parts = Math.abs(n).toFixed(2).split('.');
    var intp = parts[0];
    var last3 = intp.slice(-3);
    var rest = intp.slice(0, -3);
    if (rest) {
      rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
      intp = rest + ',' + last3;
    } else {
      intp = last3;
    }
    return (neg ? '-' : '') + intp + '.' + parts[1];
  }

  function currency() {
    return (S.settings && S.settings.currency_symbol) || '₹';
  }

  function money(n) { return currency() + fmt(n); }

  /** Server dates are YYYY-MM-DD; show DD-MM-YYYY. */
  function dstr(d) {
    if (!d) return '';
    var p = String(d).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : String(d);
  }

  /** Today's date as YYYY-MM-DD, from the handset's own clock. */
  function todayStr(offsetDays) {
    var d = new Date();
    if (offsetDays) d = new Date(d.getTime() + offsetDays * 86400000);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function firstOfMonth() { return todayStr().slice(0, 8) + '01'; }

  /* -------------------------------- toast ------------------------------ */
  var toastTimer = null;
  function toast(msg, kind) {
    var el = $('toast');
    if (!el) return;
    el.className = kind === false || kind === 'err' ? 'err' : (kind === 'info' ? 'info' : 'ok');
    el.innerHTML = esc(msg);
    el.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, 3600);
  }

  /**
   * Server error codes → translation keys. Mirrors the React app's
   * frontend/src/utils/apiError.js so both clients speak the same language.
   */
  var ERRMAP = {
    ERR_INSUFFICIENT_STOCK: 'eStock',
    ERR_PAYMENT_RANGE: 'ePay',
    ERR_EMPTY_LIST: 'eEmpty',
    ERR_NOT_FOUND: 'eNotFound',
    ERR_DISCOUNT_RANGE: 'eDisc',
    ERR_QTY_POSITIVE: 'qtyErr',
    ERR_QTY_NEGATIVE: 'qtyNeg',
    ERR_REQUIRED: 'required',
    ERR_INVALID_ENUM: 'eEnum',
    ERR_INVALID_DATE: 'eDate',
    ERR_AMOUNT_POSITIVE: 'eAmount',
    ERR_ALREADY_CANCELLED: 'eAlreadyCancelled',
    ERR_CANCELLED: 'eCancelledDoc',
    ERR_ALREADY_CONVERTED: 'eConverted',
    ERR_SAME_WAREHOUSE: 'eSameWh',
    ERR_UNBALANCED: 'eUnbalanced',
    ERR_INTERNAL: 'eServer'
  };

  function showErr(e) {
    var code = e && e.code;
    if (code && ERRMAP[code]) {
      // Stock errors carry the product name and quantities, which is more
      // useful on a counter than the generic sentence.
      if (code === 'ERR_INSUFFICIENT_STOCK' && e.message) {
        toast(t('eStock') + ': ' + String(e.message).replace(/^Insufficient stock for /, ''), false);
        return;
      }
      toast(t(ERRMAP[code]), false);
      return;
    }
    toast((e && e.message) || t('netError'), false);
  }

  /* --------------------------------- API ------------------------------- */
  /**
   * Minimal XHR wrapper. `cb(err, data, fullResponse)`.
   * Errors are normalised to { message, code, status } so callers never have
   * to poke at the raw response.
   */
  function api(method, url, body, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    // Old IE aggressively caches GETs that lack cache headers; a POS must
    // never show yesterday's stock.
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    try { xhr.timeout = 25000; } catch (eT) { /* very old XHR has no timeout */ }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var res = null;
      try { res = JSON.parse(xhr.responseText); } catch (eP) { res = null; }
      if (xhr.status >= 200 && xhr.status < 300 && res && res.success) {
        cb(null, res.data, res);
        return;
      }
      cb({
        message: (res && res.message) || t('netError'),
        code: res && res.code,
        status: xhr.status
      });
    };
    try {
      xhr.ontimeout = function () { cb({ message: t('netError') }); };
    } catch (eO) { /* ignore */ }
    xhr.send(body ? JSON.stringify(body) : null);
  }

  /** Build a querystring from a plain object, skipping empty values. */
  function qs(params) {
    var out = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    return out.length ? '?' + out.join('&') : '';
  }

  /* ====================================================================
   * Money math mirrored from the backend (utils/helpers.js).
   *
   * The phone must reach the same grand total as the server to the paisa,
   * because a cash bill posts paid_amount = grandTotal; a mismatch would come
   * back "partial" and leave a phantom balance on the customer's account.
   * ==================================================================== */
  function lineCalc(qty, price, discType, discValue, rate, ttype) {
    var gross = num(qty) * num(price);
    var discountAmount = discType === 'percent'
      ? round2(gross * num(discValue) / 100)
      : num(discValue);
    var afterDiscount = gross - discountAmount;
    var taxable, tax, total;
    if (ttype === 'none' || num(rate) === 0) {
      taxable = round2(afterDiscount); tax = 0; total = round2(afterDiscount);
    } else if (ttype === 'inclusive') {
      taxable = round2(afterDiscount / (1 + num(rate) / 100));
      tax = round2(afterDiscount - taxable);
      total = round2(afterDiscount);
    } else {
      taxable = round2(afterDiscount);
      tax = round2(afterDiscount * num(rate) / 100);
      total = round2(afterDiscount + tax);
    }
    return {
      subtotal: round2(gross), discountAmount: round2(discountAmount),
      taxableAmount: taxable, taxAmount: tax, total: total
    };
  }

  function discountBase(item) {
    if (item.tax_type === 'inclusive') return Math.max(0, num(item.total));
    return Math.max(0, num(item.taxable_amount));
  }

  function allocateProportionally(amount, bases) {
    var i, totalBase = 0;
    for (i = 0; i < bases.length; i++) totalBase += num(bases[i]);
    var target = round2(amount);
    var out = [];
    if (target <= 0 || totalBase <= 0) {
      for (i = 0; i < bases.length; i++) out.push(0);
      return out;
    }
    var allocated = 0, lastPositive = -1;
    for (i = 0; i < bases.length; i++) { if (num(bases[i]) > 0) lastPositive = i; }
    for (i = 0; i < bases.length; i++) {
      if (num(bases[i]) <= 0) { out.push(0); continue; }
      var share = (i === lastPositive)
        ? round2(target - allocated)
        : round2(target * num(bases[i]) / totalBase);
      allocated = round2(allocated + share);
      out.push(share);
    }
    return out;
  }

  /**
   * Document totals for a list of cart lines.
   * `lines` carry { qty, price, discType, discValue, rate, ttype }.
   */
  function documentTotals(lines, discType, discValue, shipping, other, roundOff) {
    var i, gross = 0, lineDiscount = 0, items = [];
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      var calc = lineCalc(l.qty, l.price, l.discType || 'amount', l.discValue || 0, l.rate, l.ttype);
      gross += num(l.qty) * num(l.price);
      lineDiscount = round2(lineDiscount + calc.discountAmount);
      items.push({
        tax_type: l.ttype, tax_rate: num(l.rate),
        taxable_amount: calc.taxableAmount, tax_amount: calc.taxAmount, total: calc.total
      });
    }
    var subtotal = round2(gross);

    var bases = [];
    for (i = 0; i < items.length; i++) bases.push(discountBase(items[i]));
    var baseSum = 0;
    for (i = 0; i < bases.length; i++) baseSum = round2(baseSum + bases[i]);

    var invoiceDiscount = discType === 'percent'
      ? round2(baseSum * num(discValue) / 100)
      : round2(num(discValue));
    if (invoiceDiscount > baseSum) invoiceDiscount = baseSum;

    var alloc = allocateProportionally(invoiceDiscount, bases);
    var taxAmount = 0, lineTotals = 0, allocatedDiscount = 0;

    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var a = round2(alloc[i] || 0);
      allocatedDiscount = round2(allocatedDiscount + a);
      var taxable, tax, total;
      if (it.tax_type === 'inclusive' && it.tax_rate > 0) {
        var dg = round2(Math.max(0, it.total - a));
        taxable = round2(dg / (1 + it.tax_rate / 100));
        tax = round2(dg - taxable);
        total = dg;
      } else if (it.tax_type === 'none' || it.tax_rate === 0) {
        taxable = round2(Math.max(0, discountBase(it) - a));
        tax = 0;
        total = taxable;
      } else {
        taxable = round2(Math.max(0, discountBase(it) - a));
        tax = round2(taxable * it.tax_rate / 100);
        total = round2(taxable + tax);
      }
      taxAmount = round2(taxAmount + tax);
      lineTotals = round2(lineTotals + total);
    }

    var grandTotal = round2(lineTotals + num(shipping) + num(other) + num(roundOff));
    return {
      subtotal: subtotal,
      discountAmount: round2(lineDiscount + allocatedDiscount),
      taxAmount: taxAmount,
      grandTotal: Math.max(0, grandTotal)
    };
  }

  /* --------------------------- shared renderers ------------------------ */
  function spinner() {
    return '<div class="center pad muted">' + esc(t('loading')) + '</div>';
  }

  function emptyCard(msg) {
    return '<div class="card muted center">' + esc(msg || t('noData')) + '</div>';
  }

  function errorCard(err, retryJs) {
    return '<div class="card center pad">' + esc((err && err.message) || t('netError'))
      + '<button type="button" class="btn" onclick="' + retryJs + '">' + esc(t('retry')) + '</button></div>';
  }

  function kv(label, value, cls) {
    return '<div class="kv"><span class="k">' + esc(label) + '</span>'
      + '<span class="v ' + (cls || '') + '">' + esc(value) + '</span></div>';
  }

  function kpi(value, label, cls) {
    return '<div class="kpi"><div class="kpiin">'
      + '<div class="kpival ' + (cls || '') + '">' + esc(value) + '</div>'
      + '<div class="kpilbl">' + esc(label) + '</div></div></div>';
  }

  function statusChip(status) {
    var map = {
      paid: 'green', completed: 'green', partial: 'orange', pending: 'orange',
      unpaid: 'red', cancelled: 'red', draft: 'grey', converted: 'blue'
    };
    var labels = {
      paid: t('paidL'), partial: t('partialL'), unpaid: t('unpaidL'),
      completed: t('stCompleted'), cancelled: t('stCancelled'),
      draft: t('stDraft'), pending: t('stPending'), converted: t('stConverted')
    };
    var key = String(status || '');
    return '<span class="chip ' + (map[key] || 'grey') + '">' + esc(labels[key] || key) + '</span>';
  }

  function sectionTitle(text, right) {
    return '<div class="cardh">' + esc(text) + (right ? ' <span class="muted">' + right + '</span>' : '') + '</div>';
  }

  /** Date range picker used by every report screen. */
  function dateRangeFields(fromId, toId, fromVal, toVal) {
    return '<div class="fldrow">'
      + '<div class="fldhalf"><label class="fld" for="' + fromId + '">' + esc(t('from')) + '</label>'
      + '<input type="date" id="' + fromId + '" value="' + esc(fromVal) + '" /></div>'
      + '<div class="fldhalf"><label class="fld" for="' + toId + '">' + esc(t('to')) + '</label>'
      + '<input type="date" id="' + toId + '" value="' + esc(toVal) + '" /></div>'
      + '</div>';
  }

  /**
   * Debounced live search. Old browsers fire keyup for every character and a
   * 2G-era LAN still needs a beat, so 280ms keeps requests sane.
   */
  var searchTimers = {};
  function debounce(key, fn, ms) {
    if (searchTimers[key]) clearTimeout(searchTimers[key]);
    searchTimers[key] = setTimeout(fn, ms || 280);
  }

  return {
    S: S, STR: STR, t: t,
    $: $, esc: esc, jsq: jsq, val: val, trim: trim, num: num, round2: round2,
    toInt: toInt, findBy: findBy, fmt: fmt, money: money, currency: currency,
    dstr: dstr, todayStr: todayStr, firstOfMonth: firstOfMonth,
    toast: toast, showErr: showErr, api: api, qs: qs,
    lineCalc: lineCalc, documentTotals: documentTotals,
    spinner: spinner, emptyCard: emptyCard, errorCard: errorCard,
    kv: kv, kpi: kpi, statusChip: statusChip, sectionTitle: sectionTitle,
    dateRangeFields: dateRangeFields, debounce: debounce
  };
}());
