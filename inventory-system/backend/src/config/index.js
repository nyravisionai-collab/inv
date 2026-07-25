const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

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
  companyName: process.env.COMPANY_NAME || 'My Business',
  currency: process.env.CURRENCY || 'INR',
  currencySymbol: process.env.CURRENCY_SYMBOL || '₹',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
};
