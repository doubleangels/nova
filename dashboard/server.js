const express = require('express');
const session = require('express-session');
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');
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
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;
  if (!sessionSecret) {
    logger.warn('DASHBOARD_SESSION_SECRET is not set — using insecure fallback. Set it in Doppler.');
  }
  app.use(session({
    secret: sessionSecret || 'nova-dashboard-insecure-fallback',
    resave: false,
    saveUninitialized: false,
    store: new KeyvSessionStore(),
    cookie: {
      httpOnly: true,
      // For OAuth state to survive redirect, cookie security must match the URL scheme.
      // Default to secure only when DASHBOARD_BASE_URL is https://, with env override.
      secure: useSecureCookie,
      maxAge: SESSION_TTL_MS,
    },
  }));

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
