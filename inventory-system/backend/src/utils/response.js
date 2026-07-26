function success(res, data = null, message = 'Success', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

/**
 * `code` is a stable machine-readable identifier (e.g. ERR_INSUFFICIENT_STOCK).
 * The frontend translates it, falling back to `message` when unknown, so users
 * are never shown untranslated English server text.
 */
function error(res, message = 'Error', status = 400, errors = null, code = null) {
  const body = { success: false, message };
  if (code) body.code = code;
  if (errors) body.errors = errors;
  return res.status(status).json(body);
}

function paginated(res, rows, total, page, limit, message = 'Success') {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.max(1, parseInt(limit, 10) || 20);
  return res.json({
    success: true,
    message,
    data: rows,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  });
}

module.exports = { success, error, paginated };
