const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const config = require('./config');

async function bootstrap() {
  // Ensure directories (Termux-safe absolute paths)
  const dirs = [
    config.uploadDir,
    config.backupDir,
    path.dirname(path.resolve(config.dbPath)),
    path.join(__dirname, '../logs'),
    path.join(__dirname, '../data'),
    path.join(config.uploadDir, 'logos'),
    path.join(config.uploadDir, 'products'),
    path.join(config.uploadDir, 'avatars'),
    path.join(config.uploadDir, 'imports'),
    path.join(config.uploadDir, 'misc'),
  ];
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  }

  // Ensure .env exists
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(
      envPath,
      [
        'PORT=5000',
        'HOST=0.0.0.0',
        'JWT_SECRET=inventory_mgmt_super_secret_jwt_key_2026_change_in_prod',
        'JWT_EXPIRES_IN=7d',
        'DB_PATH=./data/inventory.db',
        'UPLOAD_DIR=./uploads',
        'BACKUP_DIR=./backups',
        'NODE_ENV=production',
        'RATE_LIMIT_WINDOW_MS=900000',
        'RATE_LIMIT_MAX=500',
        'BCRYPT_ROUNDS=10',
        'CORS_ORIGIN=*',
        'COMPANY_NAME=My Business',
        'CURRENCY=INR',
        'CURRENCY_SYMBOL=₹',
        'TIMEZONE=Asia/Kolkata',
        '',
      ].join('\n')
    );
  }

  // Init pure-JS SQLite (sql.js) + migrate — fresh empty business data only
  const db = require('./db/database');
  await db.init();

  const migrate = require('./db/migrate');
  await migrate();

  // Ensure minimal system defaults for offline desktop mode (no demo data)
  try {
    const sysUser = db.prepare("SELECT id FROM users WHERE username = 'local' OR id = 1 LIMIT 1").get();
    if (!sysUser) {
      db.prepare(`
        INSERT INTO users (username, email, password_hash, full_name, role, permissions, is_active)
        VALUES ('local', 'local@localhost', 'no-auth', 'Local User', 'admin', '{"all":true}', 1)
      `).run();
    }
    const cash = db.prepare("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get();
    if (!cash) {
      db.prepare(`
        INSERT INTO bank_accounts (account_name, account_type, opening_balance, current_balance, is_default, is_active)
        VALUES ('Cash in Hand', 'cash', 0, 0, 1, 1)
      `).run();
    }
    const wh = db.prepare('SELECT id FROM warehouses WHERE is_active = 1 LIMIT 1').get();
    if (!wh) {
      db.prepare(`
        INSERT INTO warehouses (name, code, is_default, is_active)
        VALUES ('Main Store', 'MAIN', 1, 1)
      `).run();
    }
    const unitCount = db.prepare('SELECT COUNT(*) as c FROM units WHERE is_active = 1').get().c;
    if (!unitCount) {
      const iu = db.prepare('INSERT INTO units (name, short_name, allow_fractional) VALUES (?,?,?)');
      [['Piece', 'pcs', 0], ['Kilogram', 'kg', 1], ['Litre', 'ltr', 1], ['Meter', 'mtr', 1], ['Box', 'box', 0]].forEach((u) => iu.run(...u));
    }
    const taxCount = db.prepare('SELECT COUNT(*) as c FROM tax_rates WHERE is_active = 1').get().c;
    if (!taxCount) {
      const it = db.prepare('INSERT INTO tax_rates (name, rate, cgst, sgst, igst) VALUES (?,?,?,?,?)');
      [['GST 0%', 0, 0, 0, 0], ['GST 5%', 5, 2.5, 2.5, 5], ['GST 12%', 12, 6, 6, 12], ['GST 18%', 18, 9, 9, 18], ['GST 28%', 28, 14, 14, 28]].forEach((t) => it.run(...t));
    }
    db.persist();
  } catch (e) {
    console.warn('System defaults setup:', e.message);
  }

  const app = express();

  // Trust proxy for Termux / reverse proxies
  app.set('trust proxy', 1);

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
  );

  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    message: { success: false, message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // XSS basic protection
  app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
      const sanitize = (obj) => {
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'string') {
            obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
          } else if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            sanitize(obj[key]);
          }
        }
      };
      sanitize(req.body);
    }
    next();
  });

  app.use('/uploads', express.static(path.resolve(config.uploadDir)));

  app.use('/api', require('./routes'));

  // Optional: serve built frontend from same origin (production single-port)
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist) && process.env.SERVE_FRONTEND === '1') {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    if (err.name === 'MulterError' || (err.constructor && err.constructor.name === 'MulterError')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.message === 'Invalid file type') {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(err.status || 500).json({
      success: false,
      message: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
    });
  });

  app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, message: 'API endpoint not found' });
  });

  const PORT = config.port || 5000;
  const HOST = config.host || '0.0.0.0';

  return await new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`
╔══════════════════════════════════════════════════╗
║   Inventory Management System (Termux Ready)     ║
║   Backend:  http://${HOST}:${PORT}                  ║
║   API:      http://${HOST}:${PORT}/api              ║
║   Health:   http://${HOST}:${PORT}/api/health       ║
║   SQLite:   sql.js (pure JS, no NDK)             ║
╚══════════════════════════════════════════════════╝
  `);
      resolve({ app, server, db });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} in use. Set PORT env or stop the other process.`);
        reject(err);
      } else {
        reject(err);
      }
    });

    const shutdown = () => {
      try {
        db.persist();
        db.close();
      } catch {
        /* ignore */
      }
      server.close(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });
}

// Start when run directly
if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { bootstrap };
