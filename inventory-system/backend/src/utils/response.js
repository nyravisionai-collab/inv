function success(res, data = null, message = 'Success', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

function error(res, message = 'Error', status = 400, errors = null) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
}

function paginated(res, rows, total, page, limit, message = 'Success') {
  return res.json({
    success: true,
    message,
    data: rows,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    },
  });
}

module.exports = { success, error, paginated };
