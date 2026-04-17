const express = require('express');
const session = require('express-session');
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');
const crypto = require('crypto');
const logger = require('../logger')('dashboard');

// ─── SQLite-backed session store ─────────────────────────────────────────────
// Persists sessions to the same SQLite database as the bot, so logins survive
// bot restarts. Uses a separate 'sessions' namespace to avoid key collisions.
const requireDefault = (m) => (require(m).default || require(m));
const Keyv        = requireDefault('keyv');
const KeyvSqlite  = requireDefault('@keyv/sqlite');
const Store       = session.Store;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class KeyvSessionStore extends Store {
  constructor() {
    super();
    const dataDir    = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
    const sqlitePath = path.join(dataDir, 'database.sqlite');
    this._kv = new Keyv({
      store: new KeyvSqlite(`sqlite://${sqlitePath}`, { table: 'keyv', busyTimeout: 10000 }),
      namespace: 'sessions',
    });
    this._kv.on('error', err => logger.error('Session store error.', { err }));
  }
  get(sid, cb)         { this._kv.get(sid).then(s  => cb(null, s || null)).catch(cb); }
  set(sid, sess, cb)   {
    const ttl = typeof sess?.cookie?.maxAge === 'number' ? sess.cookie.maxAge : SESSION_TTL_MS;
    this._kv.set(sid, sess, ttl).then(() => cb(null)).catch(cb);
  }
  destroy(sid, cb)     { this._kv.delete(sid).then(() => cb(null)).catch(cb); }
}

/**
 * Creates and returns the Express dashboard app.
 * Call app.listen() from the caller (index.js) after the Discord client is ready.
 *
 * @param {import('discord.js').Client} client - The live Discord client instance
 * @returns {import('express').Application}
 */
function createDashboard(client, options = {}) {
  const app = express();
  app.set('client', client);
  const dashboardBaseUrl = String(options.dashboardBaseUrl || process.env.DASHBOARD_BASE_URL || '').replace(/\/$/, '');
  const isHttpsBaseUrl = /^https:\/\//i.test(dashboardBaseUrl);
  const useSecureCookie = typeof options.useSecureCookie === 'boolean'
    ? options.useSecureCookie
    : isHttpsBaseUrl;
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowInsecurePrivateNetwork =
    String(process.env.ALLOW_INSECURE_DASHBOARD_ON_PRIVATE_NETWORK || '').trim().toLowerCase() === 'true';
  if (isProd && !useSecureCookie && !allowInsecurePrivateNetwork) {
    throw new Error('Dashboard requires secure cookies in production (set HTTPS DASHBOARD_BASE_URL).');
  }
  if (isProd && !useSecureCookie && allowInsecurePrivateNetwork) {
    logger.warn('Dashboard insecure-cookie mode enabled in production via private-network override. Restrict access to trusted internal network only.', {
      dashboardBaseUrl
    });
  }

  app.locals.dashboardBaseUrl = dashboardBaseUrl;
  app.locals.useSecureCookie = useSecureCookie;

  // Trust proxy headers when running behind nginx / Caddy
  app.set('trust proxy', 1);

  // View engine + layouts
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(ejsLayouts);
  app.set('layout', 'layout');

  // Body parsing (large limit: database JSON import from Maintenance)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Sessions — store in memory (acceptable for single-admin bot dashboard)
  const isDev = (process.env.NODE_ENV || '').toLowerCase() === 'development';
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET || (isDev ? crypto.randomBytes(32).toString('hex') : '');
  if (!sessionSecret) {
    throw new Error('DASHBOARD_SESSION_SECRET is required in non-development environments.');
  }
  if (!process.env.DASHBOARD_SESSION_SECRET && isDev) {
    logger.warn('DASHBOARD_SESSION_SECRET is not set; using an ephemeral development-only secret.');
  }
  app.use(session({
    secret: sessionSecret || 'nova-dashboard-insecure-fallback',
    resave: false,
    saveUninitialized: false,
    store: new KeyvSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // For OAuth state to survive redirect, cookie security must match the URL scheme.
      // Default to secure only when DASHBOARD_BASE_URL is https://, with env override.
      secure: useSecureCookie,
      maxAge: SESSION_TTL_MS,
    },
  }));

  // CSRF token bootstrap for server-rendered pages and XHR.
  app.use((req, res, next) => {
    if (req.session && !req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.locals.csrfToken = req.session?.csrfToken || '';
    next();
  });

  function isUnsafeMethod(method) {
    return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  }

  function isSameOrigin(req) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    const expected = req.app.locals.dashboardBaseUrl || '';
    const expectedUrl = expected ? new URL(expected) : null;
    if (!origin) {
      if (!referer) return false;
      try {
        const r = new URL(referer);
        if (expectedUrl) return r.host === expectedUrl.host && r.protocol === expectedUrl.protocol;
        return r.host === req.get('host') && r.protocol === `${req.protocol}:`;
      } catch {
        return false;
      }
    }
    try {
      const u = new URL(origin);
      if (expectedUrl) return u.host === expectedUrl.host && u.protocol === expectedUrl.protocol;
      return u.host === req.get('host') && u.protocol === `${req.protocol}:`;
    } catch {
      return false;
    }
  }

  // CSRF + origin validation for mutating dashboard API routes.
  app.use('/api', (req, res, next) => {
    if (!isUnsafeMethod(req.method)) return next();
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    }
    const token = req.get('x-csrf-token') || req.body?._csrf;
    if (!token || token !== req.session?.csrfToken) {
      return res.status(403).json({ error: 'Invalid CSRF token.' });
    }
    next();
  });

  // Make the Discord client available in every request
  app.use((req, _res, next) => {
    req.discordClient = client;
    next();
  });

  // Routes
  app.use('/auth', require('./routes/auth'));
  app.use('/api',  require('./routes/api'));
  app.use('/',     require('./routes/pages'));

  // 404 handler
  app.use((req, res) => {
    const guild = req.discordClient?.guilds?.cache?.first();
    const botIcon = req.discordClient?.user?.displayAvatarURL({ extension: 'png', size: 128 }) || null;
    res.status(404).render('error', {
      title: 'Not Found', message: 'Page not found.',
      user: req.session?.user || null,
      guildName: guild?.name || 'Da Frens',
      guildIcon: guild?.iconURL({ size: 64 }) || null,
      botIcon,
    });
  });

  // Global error handler
  app.use((err, req, res, _next) => {
    logger.error('Dashboard unhandled error.', { err });
    const guild = req.discordClient?.guilds?.cache?.first();
    const botIcon = req.discordClient?.user?.displayAvatarURL({ extension: 'png', size: 128 }) || null;
    res.status(500).render('error', {
      title: 'Server Error', message: 'An unexpected error occurred.',
      user: req.session?.user || null,
      guildName: guild?.name || 'Da Frens',
      guildIcon: guild?.iconURL({ size: 64 }) || null,
      botIcon,
    });
  });

  return app;
}

module.exports = createDashboard;
