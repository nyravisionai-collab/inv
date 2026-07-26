const bcrypt = require('bcryptjs');
const db = require('../db/database');
const config = require('../config');
const { success, error, paginated } = require('../utils/response');
const { pageParams } = require('../utils/validate');
const { now, sanitizeLike } = require('../utils/helpers');

const DEFAULT_PERMISSIONS = {
  admin: { all: true },
  manager: {
    dashboard: true, sales: true, purchase: true, inventory: true,
    customers: true, suppliers: true, accounting: true, reports: true,
    settings: false, users: false,
  },
  staff: {
    dashboard: true, sales: true, purchase: true, inventory: true,
    customers: true, suppliers: true, accounting: false, reports: true,
    settings: false, users: false,
  },
  cashier: {
    dashboard: true, sales: true, purchase: false, inventory: false,
    customers: true, suppliers: false, accounting: false, reports: false,
    settings: false, users: false, pos: true,
  },
};

function list(req, res) {
  try {
    const { page = 1, limit = 20, search, role, is_active } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (username LIKE ? ESCAPE \'!\' OR email LIKE ? ESCAPE \'!\' OR full_name LIKE ? ESCAPE \'!\')';
      const s = `%${sanitizeLike(search)}%`;
      params.push(s, s, s);
    }
    if (role) { where += ' AND role = ?'; params.push(role); }
    if (is_active === undefined || is_active === '' || is_active === null) {
      where += ' AND is_active = 1';
    } else {
      where += ' AND is_active = ?';
      params.push(is_active === '1' || is_active === 'true' || is_active === true ? 1 : 0);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM users ${where}`).get(...params).c;
    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit });
    const rows = db.prepare(`
      SELECT id, username, email, full_name, phone, role, permissions, is_active, avatar, last_login, created_at
      FROM users ${where} ORDER BY full_name LIMIT ? OFFSET ?
    `).all(...params, lim, offset);

    rows.forEach(u => { u.permissions = JSON.parse(u.permissions || '{}'); });
    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getById(req, res) {
  try {
    const u = db.prepare(`
      SELECT id, username, email, full_name, phone, role, permissions, is_active, avatar, last_login, created_at
      FROM users WHERE id = ?
    `).get(req.params.id);
    if (!u) return error(res, 'User not found', 404);
    u.permissions = JSON.parse(u.permissions || '{}');
    return success(res, u);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function create(req, res) {
  try {
    const { username, email, password, full_name, phone, role, permissions } = req.body;
    if (!username || !email || !password || !full_name) {
      return error(res, 'Username, email, password and full name required');
    }

    const active = db.prepare('SELECT id FROM users WHERE (username = ? OR email = ?) AND is_active = 1').get(username, email);
    if (active) return error(res, 'Username or email already exists');

    const userRole = role || 'staff';
    const perms = permissions || DEFAULT_PERMISSIONS[userRole] || DEFAULT_PERMISSIONS.staff;
    const hash = bcrypt.hashSync(password, config.bcryptRounds);

    // Restore soft-deleted user with same username
    const inactive = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 0').get(username)
      || db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 0').get(email);
    if (inactive) {
      db.prepare(`
        UPDATE users SET username=?, email=?, password_hash=?, full_name=?, phone=?, role=?, permissions=?, is_active=1, updated_at=?
        WHERE id=?
      `).run(username, email, hash, full_name, phone || null, userRole, JSON.stringify(perms), now(), inactive.id);
      const user = db.prepare(`
        SELECT id, username, email, full_name, phone, role, permissions, is_active, created_at FROM users WHERE id = ?
      `).get(inactive.id);
      user.permissions = JSON.parse(user.permissions || '{}');
      return success(res, user, 'User restored', 201);
    }

    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, permissions)
      VALUES (?,?,?,?,?,?,?)
    `).run(username, email, hash, full_name, phone || null, userRole, JSON.stringify(perms));

    const user = db.prepare(`
      SELECT id, username, email, full_name, phone, role, permissions, is_active, created_at FROM users WHERE id = ?
    `).get(result.lastInsertRowid);
    user.permissions = JSON.parse(user.permissions || '{}');
    return success(res, user, 'User created', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function update(req, res) {
  try {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'User not found', 404);

    const b = req.body;
    const perms = b.permissions ? JSON.stringify(b.permissions) : existing.permissions;

    db.prepare(`
      UPDATE users SET full_name=?, email=?, phone=?, role=?, permissions=?, is_active=?, updated_at=? WHERE id=?
    `).run(
      b.full_name ?? existing.full_name,
      b.email ?? existing.email,
      b.phone !== undefined ? b.phone : existing.phone,
      b.role || existing.role,
      perms,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      now(), req.params.id
    );

    if (b.password) {
      const hash = bcrypt.hashSync(b.password, config.bcryptRounds);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
    }

    const user = db.prepare(`
      SELECT id, username, email, full_name, phone, role, permissions, is_active, created_at FROM users WHERE id = ?
    `).get(req.params.id);
    user.permissions = JSON.parse(user.permissions || '{}');
    return success(res, user, 'User updated');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function remove(req, res) {
  try {
    if (Number(req.params.id) === req.user.id) return error(res, 'Cannot delete yourself');
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return error(res, 'User not found', 404);
    // Free unique username/email for reuse after delete
    const freedUser = `${existing.username}__del__${existing.id}`;
    const freedEmail = `del_${existing.id}_${existing.email}`;
    db.prepare('UPDATE users SET is_active = 0, username = ?, email = ?, updated_at = ? WHERE id = ?')
      .run(freedUser, freedEmail, now(), req.params.id);
    return success(res, null, 'User deleted');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function getPermissions(req, res) {
  return success(res, DEFAULT_PERMISSIONS);
}

function auditLogs(req, res) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const total = db.prepare('SELECT COUNT(*) as c FROM audit_logs').get().c;
    const { page: pageNo, limit: lim, offset } = pageParams({ page, limit }, { defaultLimit: 50 });
    const rows = db.prepare(`
      SELECT a.*, u.full_name as user_name, u.username
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(lim, offset);
    return paginated(res, rows, total, pageNo, lim);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, getById, create, update, remove, getPermissions, auditLogs, DEFAULT_PERMISSIONS };
