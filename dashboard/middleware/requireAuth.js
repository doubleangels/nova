/**
 * Express middleware that enforces Discord OAuth authentication.
 * Redirects unauthenticated requests to /login.
 * API routes receive a 401 JSON response instead of a redirect.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  // JSON API requests get a 401 instead of a redirect
  if (req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

module.exports = requireAuth;
