const db = require('../db/database');
const { success, error } = require('../utils/response');
const stockService = require('../services/stockService');
const { today } = require('../utils/helpers');

function list(req, res) {
  try {
    const rows = db.prepare(`
      SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL
      ORDER BY created_at DESC LIMIT 50
    `).all(req.user.id);
    const unread = db.prepare(`
      SELECT COUNT(*) as c FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0
    `).get(req.user.id).c;
    return success(res, { notifications: rows, unread });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function markRead(req, res) {
  try {
    if (req.params.id === 'all') {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_id IS NULL').run(req.user.id);
    } else {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
    }
    return success(res, null, 'Marked as read');
  } catch (err) {
    return error(res, err.message, 500);
  }
}

function checkAlerts(req, res) {
  try {
    const lowStockCount = stockService.createLowStockNotifications();

    // Due payments - overdue sales
    const overdue = db.prepare(`
      SELECT s.id, s.invoice_number, s.balance_amount, s.due_date, c.name as customer_name
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.status='completed' AND s.balance_amount > 0 AND s.due_date IS NOT NULL AND s.due_date < ?
    `).all(today());

    const admins = db.prepare("SELECT id FROM users WHERE role IN ('admin','manager') AND is_active=1").all();
    const insert = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
      VALUES (?, 'overdue', ?, ?, 'sale', ?)
    `);

    for (const o of overdue) {
      for (const u of admins) {
        const exists = db.prepare(`
          SELECT id FROM notifications WHERE user_id=? AND type='overdue' AND reference_id=? AND is_read=0
          AND date(created_at)=date('now','localtime')
        `).get(u.id, o.id);
        if (!exists) {
          insert.run(u.id, 'Overdue Payment', `${o.customer_name || 'Customer'} - ${o.invoice_number} overdue. Balance: ₹${o.balance_amount}`, o.id);
        }
      }
    }

    // Due payments soon
    const dueSoon = db.prepare(`
      SELECT COUNT(*) as c FROM sales
      WHERE status='completed' AND balance_amount > 0 AND due_date BETWEEN ? AND date(?, '+3 days')
    `).get(today(), today()).c;

    return success(res, {
      lowStockCount,
      overdueCount: overdue.length,
      dueSoonCount: dueSoon,
    });
  } catch (err) {
    return error(res, err.message, 500);
  }
}

module.exports = { list, markRead, checkAlerts };
