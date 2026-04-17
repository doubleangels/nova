const { captureError } = require('../instrument');

/**
 * Report a dashboard HTTP error to Sentry with request context.
 * @param {unknown} err
 * @param {import('express').Request} req
 * @param {Record<string, string>} [tags] - Merged into tags (e.g. area: 'dashboard:api', op: 'settings')
 */
function reportDashboardError(err, req, tags = {}) {
  captureError(err, {
    path: String(req.path || ''),
    method: String(req.method || ''),
    ...tags
  });
}

module.exports = { reportDashboardError };
