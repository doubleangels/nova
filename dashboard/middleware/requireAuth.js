const { PermissionFlagsBits } = require('discord.js');

const AUTHZ_RECHECK_MS = 5 * 60 * 1000;

function isApiRequest(req) {
  return req.path.startsWith('/api') || req.headers.accept?.includes('application/json');
}

function sanitizeReturnTo(raw) {
  const val = String(raw || '').trim();
  if (!val.startsWith('/')) return '/';
  if (val.startsWith('//')) return '/';
  return val;
}

async function stillHasDashboardAccess(req) {
  const userId = req.session?.user?.id;
  if (!userId) return false;
  const guild = req.discordClient?.guilds?.cache?.first();
  if (!guild) return false;
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  const perms = member.permissions;
  return (
    perms.has(PermissionFlagsBits.Administrator) ||
    perms.has(PermissionFlagsBits.ManageGuild)
  );
}

/**
 * Express middleware that enforces Discord OAuth authentication + periodic authz recheck.
 * Redirects unauthenticated requests to /login.
 * API routes receive a 401/403 JSON response instead of a redirect.
 */
async function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    const checkedAt = Number(req.session.authzCheckedAt || 0);
    const now = Date.now();
    if (!Number.isFinite(checkedAt) || now - checkedAt > AUTHZ_RECHECK_MS) {
      const allowed = await stillHasDashboardAccess(req);
      if (!allowed) {
        req.session.destroy(() => {});
        if (isApiRequest(req)) {
          return res.status(403).json({ error: 'Dashboard access revoked. Please log in again.' });
        }
        return res.redirect('/login?error=not_admin');
      }
      req.session.authzCheckedAt = now;
    }
    return next();
  }
  if (isApiRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  req.session.returnTo = sanitizeReturnTo(req.originalUrl);
  return res.redirect('/login');
}

module.exports = requireAuth;
