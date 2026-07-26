const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

/**
 * Parse the TRUST_PROXY setting.
 * Accepts "1"/"true" (trust one hop), a hop count, or a comma-separated list
 * of trusted addresses. Anything else disables proxy trust, which is the safe
 * default for a directly exposed LAN server.
 */
function parseTrustProxy(raw) {
  if (!raw) return false;
  const value = String(raw).trim();
  if (value === '' || value === '0' || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') return 1;
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) return n;
  return value; // e.g. "loopback" or an explicit IP list
}

function parseBool(raw, fallback = false) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

module.exports = {
  port: parseInt(process.env.PORT || '5000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'inventory_mgmt_super_secret_jwt_key_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dbPath: process.env.DB_PATH || path.join(__dirname, '../../data/inventory.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'),
  backupDir: process.env.BACKUP_DIR || path.join(__dirname, '../../backups'),
  nodeEnv: process.env.NODE_ENV || 'production',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '500', 10),
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  serveFrontend: parseBool(process.env.SERVE_FRONTEND, false),
  companyName: process.env.COMPANY_NAME || 'My Business',
  currency: process.env.CURRENCY || 'INR',
  currencySymbol: process.env.CURRENCY_SYMBOL || '₹',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
};
