const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const config = require('../config');
const { success, error } = require('../utils/response');
const { now } = require('../utils/helpers');

function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) return error(res, 'Username and password required');

    const user = db.prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1').get(username, username);
    if (!user) return error(res, 'Invalid credentials', 401);

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return error(res, 'Invalid credentials', 401);

    db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(now(), user.id);

    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    return success(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        permissions: JSON.parse(user.permissions || '{}'),
        avatar: user.avatar,
      },
    }, 'Login successful');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function register(req, res) {
  try {
    const { username, email, password, full_name, phone, role } = req.body;
    if (!username || !email || !password || !full_name) {
      return error(res, 'Username, email, password and full name are required');
    }

    const active = db.prepare('SELECT id FROM users WHERE (username = ? OR email = ?) AND is_active = 1').get(username, email);
    if (active) return error(res, 'Username or email already exists');

    const hash = bcrypt.hashSync(password, config.bcryptRounds);
    const userRole = req.user?.role === 'admin' ? (role || 'staff') : 'staff';

    const inactive = db.prepare('SELECT id FROM users WHERE (username = ? OR email = ?) AND is_active = 0').get(username, email);
    if (inactive) {
      db.prepare(`
        UPDATE users SET username=?, email=?, password_hash=?, full_name=?, phone=?, role=?, is_active=1, updated_at=?
        WHERE id=?
      `).run(username, email, hash, full_name, phone || null, userRole, now(), inactive.id);
      const user = db.prepare('SELECT id, username, email, full_name, role, phone, created_at FROM users WHERE id = ?').get(inactive.id);
      return success(res, user, 'User registered', 201);
    }

    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, email, hash, full_name, phone || null, userRole);

    const user = db.prepare('SELECT id, username, email, full_name, role, phone, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    return success(res, user, 'User registered', 201);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function me(req, res) {
  try {
    const user = db.prepare('SELECT id, username, email, full_name, phone, role, permissions, avatar, last_login, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return error(res, 'User not found', 404);
    user.permissions = JSON.parse(user.permissions || '{}');
    return success(res, user);
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return error(res, 'Current and new password required');
    if (new_password.length < 6) return error(res, 'Password must be at least 6 characters');

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(current_password, user.password_hash)) {
      return error(res, 'Current password is incorrect');
    }

    const hash = bcrypt.hashSync(new_password, config.bcryptRounds);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, now(), req.user.id);
    return success(res, null, 'Password changed successfully');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function logout(req, res) {
  return success(res, null, 'Logged out successfully');
}

module.exports = { login, register, me, changePassword, logout };
