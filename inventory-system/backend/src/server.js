const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { sanitizeDeep } = require('./utils/sanitize');
const { ValidationError } = require('./utils/validate');
const { createLanOnlyMiddleware } = require('./middleware/networkAccess');

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

  // Ensure .env exists, seeded from the single source of truth (.env.example)
  // so the server and START.sh can never drift apart.
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) {
    const examplePath = path.join(__dirname, '../.env.example');
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath);
    }
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

  // Only trust X-Forwarded-* when a reverse proxy is actually in front of us.
  // Trusting it unconditionally lets any client spoof its IP and bypass the
  // rate limiter.
  if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy);
  } else {
    app.set('trust proxy', false);
  }

  // Keep the no-login offline build limited to this machine and local networks.
  app.use(createLanOnlyMiddleware({ enabled: config.lanOnly }));

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

  // Strip HTML from every incoming string, including those nested inside
  // arrays such as invoice `items[]`.
  app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') sanitizeDeep(req.body);
    next();
  });

  app.use('/uploads', express.static(path.resolve(config.uploadDir)));

  app.use('/api', require('./routes'));

  // Optional: serve built frontend from same origin (production single-port)
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist) && config.serveFrontend) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, message: 'API endpoint not found', code: 'ERR_NOT_FOUND' });
  });

  app.use((err, req, res, next) => {
    if (err instanceof ValidationError || err.name === 'ValidationError') {
      return res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
    }
    console.error('Error:', err.message);
    if (err.name === 'MulterError' || (err.constructor && err.constructor.name === 'MulterError')) {
      return res.status(400).json({ success: false, message: err.message, code: 'ERR_UPLOAD' });
    }
    if (err.message === 'Invalid file type') {
      return res.status(400).json({ success: false, message: err.message, code: 'ERR_FILE_TYPE' });
    }
    res.status(err.status || 500).json({
      success: false,
      message: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
      code: err.code || 'ERR_INTERNAL',
    });
  });


  const PORT = config.port || 5000;
  const HOST = config.host || '0.0.0.0';

  // Optional HTTPS with the self-signed cert from scripts/generate-cert.sh.
  // Only matters for the single-port SERVE_FRONTEND=1 deployment — the PWA
  // (service worker + install prompt) needs a secure context on LAN clients.
  let httpServer = app;
  let protocol = 'http';
  if (config.https) {
    const certDir = path.join(__dirname, '../../certs');
    const keyFile = path.join(certDir, 'dev.key');
    const certFile = path.join(certDir, 'dev.crt');
    if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
      const https = require('https');
      httpServer = https.createServer(
        { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
        app
      );
      protocol = 'https';
    } else {
      console.warn(
        '[https] HTTPS=1 was set but certs/dev.key or certs/dev.crt is missing.\n' +
        '         Run "bash scripts/generate-cert.sh" first. Falling back to HTTP.'
      );
    }
  }

  return await new Promise((resolve, reject) => {
    const server = httpServer.listen(PORT, HOST, () => {
      console.log(`
╔══════════════════════════════════════════════════╗
║   Inventory Management System (Termux Ready)     ║
║   Backend:  ${protocol}://${HOST}:${PORT}                  ║
║   API:      ${protocol}://${HOST}:${PORT}/api              ║
║   Health:   ${protocol}://${HOST}:${PORT}/api/health       ║
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
