const express = require('express');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const ERROR_MESSAGES = {
  oauth_denied:       'You cancelled the Discord login.',
  missing_code:       'No authorization code received from Discord.',
  state_mismatch:     'Security check failed. Please try again.',
  server_misconfigured: 'The dashboard is not configured correctly. Contact the server owner.',
  bot_not_ready:      'The bot is not fully started yet. Please try again in a moment.',
  not_in_guild:       'You are not a member of the server this bot manages.',
  not_admin:          'You must have the Administrator permission in the server to access the dashboard.',
  auth_failed:        'Authentication failed. Please try again.',
};

router.get('/login', (req, res) => {
  const errorKey = req.query.error;
  const errorMsg = ERROR_MESSAGES[errorKey] || null;
  const guild = req.discordClient?.guilds?.cache?.first();
  // Login page has its own full HTML; skip the shared layout
  res.render('login', {
    layout: false,
    title: 'Login',
    error: errorMsg,
    guildName: guild?.name || 'Da Frens',
    guildIcon: guild?.iconURL({ size: 64 }) || null,
  });
});

router.get('/', requireAuth, (req, res) => {
  const guild = req.discordClient?.guilds?.cache?.first();
  res.render('dashboard', {
    title: 'Dashboard',
    user: req.session.user,
    guildName: guild?.name || 'Da Frens',
    guildIcon: guild?.iconURL({ size: 64 }) || null,
    memberCount: guild?.memberCount || 0,
  });
});

module.exports = router;
