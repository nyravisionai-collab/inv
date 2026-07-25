const db = require('../db/database');

function auditLog(action, entityType = null) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (body && body.success && req.user) {
        try {
          const entityId = (body.data && (body.data.id || body.data.insertId)) || req.params.id || null;
          db.prepare(`
            INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            req.user.id,
            action,
            entityType,
            entityId,
            JSON.stringify(req.method === 'GET' ? null : req.body).slice(0, 5000),
            req.ip || req.connection?.remoteAddress || '',
            (req.get('user-agent') || '').slice(0, 500)
          );
        } catch {
          // don't fail request on audit error
        }
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { auditLog };
