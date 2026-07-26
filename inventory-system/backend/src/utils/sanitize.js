/**
 * Shared sanitisation helpers.
 *
 * `redact`   — strips secrets before anything is written to the audit log.
 * `stripTags`— defence-in-depth HTML stripping for stored values.
 * `csvCell`  — neutralises CSV/spreadsheet formula injection on export.
 */

const SECRET_KEYS = new Set([
  'password',
  'new_password',
  'current_password',
  'confirm_password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'jwt',
  'secret',
  'api_key',
  'apikey',
  'authorization',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

/** Deep-clone `value`, replacing any secret-looking key with a placeholder. */
function redact(value, depth = 0) {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_KEYS.has(String(key).toLowerCase())) {
      out[key] = REDACTED;
    } else {
      out[key] = redact(val, depth + 1);
    }
  }
  return out;
}

// Remove complete tags, dangling tag openers, and inline event handlers.
const TAG_RE = /<\/?[a-z][^>]*>/gi;
const DANGLING_RE = /<\/?[a-z][^>]*$/i;
const EVENT_ATTR_RE = /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL_RE = /javascript\s*:/gi;

function stripTags(str) {
  return String(str)
    .replace(EVENT_ATTR_RE, '')
    .replace(JS_URL_RE, '')
    .replace(TAG_RE, '')
    .replace(DANGLING_RE, '');
}

/**
 * Recursively strip HTML from every string in a payload.
 * Unlike the previous implementation this also walks arrays, so strings
 * nested inside `items[]` are sanitised too.
 */
function sanitizeDeep(value, depth = 0) {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') return stripTags(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = sanitizeDeep(value[i], depth + 1);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = sanitizeDeep(value[key], depth + 1);
    return value;
  }
  return value;
}

/**
 * Prefix cells that spreadsheet software would evaluate as a formula.
 * Protects users who open an exported CSV in Excel / LibreOffice.
 */
function csvCell(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvSafeRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = csvCell(v);
    return out;
  });
}

module.exports = { redact, stripTags, sanitizeDeep, csvCell, csvSafeRows, REDACTED };
