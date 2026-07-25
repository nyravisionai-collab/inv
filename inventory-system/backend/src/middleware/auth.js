/**
 * Authentication disabled — offline desktop mode.
 * Every request is treated as the local system operator.
 */
const db = require('../db/database');

function ensureSystemUser() {
  let user = db.prepare('SELECT id, username, email, full_name, role, permissions, is_active FROM users WHERE id = 1').get();
  if (!user) {
    user = db.prepare('SELECT id, username, email, full_name, role, permissions, is_active FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  }
  if (!user) {
    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, role, permissions, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      'local',
      'local@localhost',
      'no-auth',
      'Local User',
      'admin',
      JSON.stringify({ all: true })
    );
    user = db.prepare('SELECT id, username, email, full_name, role, permissions, is_active FROM users WHERE id = ?').get(result.lastInsertRowid);
  }
  return user;
}

function authenticate(req, res, next) {
  try {
    const user = ensureSystemUser();
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: 'admin',
      permissions: { all: true },
      is_active: 1,
    };
    next();
  } catch (err) {
    // Still allow request with synthetic user if DB not ready
    req.user = { id: 1, username: 'local', full_name: 'Local User', role: 'admin', permissions: { all: true }, is_active: 1 };
    next();
  }
}

function authorize(..._roles) {
  return (req, res, next) => next();
}

function optionalAuth(req, res, next) {
  return authenticate(req, res, next);
}

module.exports = { authenticate, authorize, optionalAuth };
