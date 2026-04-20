const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const config = require('../../config');
const { colorIntToHex } = require('../../utils/dynamicConfig');
const logger = require('../../logger')('dashboard:pages');
const { reportDashboardError } = require('../sentryDashboard');

const router = express.Router();
const PUBLIC_BOT_ICON_PATH = '/assets/bot-icon.png';

const ERROR_MESSAGES = {
  oauth_denied: 'You cancelled the Discord login.',
  missing_code: 'No authorization code received from Discord.',
  state_mismatch: 'Security check failed. Please try again.',
  server_misconfigured: 'The dashboard is not configured correctly. Contact the server owner.',
  bot_not_ready: 'The bot cannot resolve which guild to use (not ready, or multiple guilds without DASHBOARD_GUILD_ID). Contact the server owner.',
  not_in_guild: 'You are not a member of the server this bot manages.',
  not_admin: 'You must have the Administrator permission in the server to access the dashboard.',
  auth_failed: 'Authentication failed. Please try again.',
};

function getPagesActor(req) {
  return req.session?.user?.username || req.session?.user?.id || 'anonymous-user';
}

router.use((req, res, next) => {
  const startedAt = Date.now();
  const actor = getPagesActor(req);
  logger.debug('Dashboard page request started.', {
    method: req.method,
    path: req.path,
    actor
  });

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const payload = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      actor
    };
    if (res.statusCode >= 500) {
      logger.error('Dashboard page request completed with a server error.', payload);
      return;
    }
    if (res.statusCode >= 400) {
      logger.warn('Dashboard page request completed with a client error.', payload);
      return;
    }
    logger.debug('Dashboard page request completed successfully.', payload);
  });

  next();
});

function getLoginThemeAccent() {
  const hex = colorIntToHex(config.baseEmbedColor || 0x7c3aed);
  const clean = hex.replace('#', '');
  const rgb = {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
  return { hex, rgb };
}

function getPublicBotIconPath() {
  return PUBLIC_BOT_ICON_PATH;
}

router.get('/login', (req, res) => {
  const errorKey = req.query.error;
  const errorMsg = ERROR_MESSAGES[errorKey] || null;
  const guild = req.dashboardGuild;
  const botIcon = getPublicBotIconPath();
  const accent = getLoginThemeAccent();
  // Login page has its own full HTML; skip the shared layout
  res.render('login', {
    layout: false,
    title: 'Login',
    error: errorMsg,
    guildName: guild?.name || 'Da Frens',
    guildIcon: guild?.iconURL({ size: 64 }) || null,
    botIcon,
    accentHex: accent.hex,
    accentRgb: accent.rgb,
  });
});

router.get('/', requireAuth, (req, res) => {
  const guild = req.dashboardGuild;
  const botIcon = getPublicBotIconPath();
  
  // Split member count into users vs bots (using cache)
  const totalCount = guild?.memberCount || 0;
  const botCount = guild?.members?.cache?.filter(m => m.user.bot)?.size || 0;
  const userCount = totalCount - botCount;

  const accent = getLoginThemeAccent();

  res.render('dashboard', {
    title: 'Dashboard',
    user: req.session.user,
    displayName: req.session.user.global_name || req.session.user.username,
    guildName: guild?.name || 'Da Frens',
    guildIcon: guild?.iconURL({ size: 64 }) || null,
    botIcon,
    memberCount: totalCount,
    humanCount: userCount,
    botCount,
    accentHex: accent.hex,
    accentRgb: accent.rgb,
  });
});

module.exports = router;
