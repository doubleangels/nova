const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../logger')('dashboard:auth');

const router = express.Router();

const DISCORD_API = 'https://discord.com/api/v10';
const OAUTH_SCOPES = 'identify guilds';

// Administrator permission bit
const ADMINISTRATOR = BigInt(0x8);

function sanitizeReturnTo(raw) {
  const val = String(raw || '').trim();
  if (!val.startsWith('/')) return '/';
  if (val.startsWith('//')) return '/';
  return val;
}

function getAuthActor(req) {
  return req.session?.user?.username || req.session?.user?.id || 'anonymous-user';
}

router.use((req, res, next) => {
  const startedAt = Date.now();
  const actor = getAuthActor(req);
  logger.debug('Dashboard auth request started.', {
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
      logger.error('Dashboard auth request completed with a server error.', payload);
      return;
    }
    if (res.statusCode >= 400) {
      logger.warn('Dashboard auth request completed with a client error.', payload);
      return;
    }
    logger.debug('Dashboard auth request completed successfully.', payload);
  });

  next();
});

function getRedirectUri(req) {
  const hostHeader = req?.get?.('host');
  const hostName = (hostHeader || '').split(':')[0].toLowerCase();
  const isLocalHost = hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '::1' || hostName === '[::1]';

  // Local testing convenience: if accessed via localhost, generate redirect_uri from the active request host.
  // This avoids toggling DASHBOARD_BASE_URL when switching between local and remote testing.
  if (isLocalHost && hostHeader) {
    const proto = req.protocol || 'http';
    return `${proto}://${hostHeader}/auth/callback`;
  }

  const base = (req?.app?.locals?.dashboardBaseUrl || process.env.DASHBOARD_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
  return `${base}/auth/callback`;
}

/**
 * Step 1 — redirect the user to Discord's OAuth2 consent screen.
 */
router.get('/discord', (req, res) => {
  const clientId = config.clientId;
  const redirectUri = encodeURIComponent(getRedirectUri(req));
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;

  const url =
    `https://discord.com/api/oauth2/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(OAUTH_SCOPES)}` +
    `&state=${state}`;

  res.redirect(url);
});

/**
 * Step 2 — Discord redirects back here with a `code`.
 * Exchange the code for a token, verify the user is an admin in the bot's guild.
 */
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.warn('Discord OAuth error returned.', { error });
    return res.redirect('/login?error=oauth_denied');
  }

  if (!code) {
    return res.redirect('/login?error=missing_code');
  }

  // CSRF check
  if (state !== req.session.oauthState) {
    logger.warn('OAuth state mismatch — possible CSRF.', { received: state });
    return res.redirect('/login?error=state_mismatch');
  }
  delete req.session.oauthState;

  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientSecret) {
    logger.error('DISCORD_CLIENT_SECRET is not set. Cannot complete OAuth.');
    return res.redirect('/login?error=server_misconfigured');
  }

  try {
    // Exchange code for access token
    const tokenRes = await axios.post(
      `${DISCORD_API}/oauth2/token`,
      new URLSearchParams({
        client_id:     config.clientId,
        client_secret: clientSecret,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  getRedirectUri(req),
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;

    // Fetch user identity and guild list in parallel
    const [userRes, guildsRes] = await Promise.all([
      axios.get(`${DISCORD_API}/users/@me`,        { headers: { Authorization: `Bearer ${accessToken}` } }),
      axios.get(`${DISCORD_API}/users/@me/guilds`,  { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);

    const user   = userRes.data;
    const guilds = guildsRes.data;

    // Determine the bot's guild ID from the live client
    const botGuild = req.discordClient?.guilds?.cache?.first();
    if (!botGuild) {
      logger.error('Bot is not in any guild yet — cannot verify admin status.');
      return res.redirect('/login?error=bot_not_ready');
    }

    // Check that the user is in the guild AND has Administrator permission
    const userGuild = guilds.find(g => g.id === botGuild.id);
    if (!userGuild) {
      logger.info('Login attempt from user not in the bot guild.', { userId: user.id });
      return res.redirect('/login?error=not_in_guild');
    }

    const perms = BigInt(userGuild.permissions || '0');
    if ((perms & ADMINISTRATOR) !== ADMINISTRATOR) {
      logger.info('Login attempt from non-admin user.', { userId: user.id });
      return res.redirect('/login?error=not_admin');
    }

    // Rotate session ID after auth to reduce fixation risk.
    const returnTo = sanitizeReturnTo(req.session.returnTo || '/');
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error('Session regenerate failed after OAuth login.', { err: regenErr });
        return res.redirect('/login?error=auth_failed');
      }
      req.session.user = {
        id:            user.id,
        username:      user.username,
        global_name:   user.global_name,
        discriminator: user.discriminator,
        avatar:        user.avatar,
      };
      req.session.authzCheckedAt = Date.now();
      logger.info('Admin logged in to dashboard.', { userId: user.id, username: user.username });
      res.redirect(returnTo);
    });

  } catch (err) {
    logger.error('OAuth callback error.', { err: err.response?.data || err.message });
    res.redirect('/login?error=auth_failed');
  }
});

/**
 * Logout — destroys the session.
 */
router.post('/logout', (req, res) => {
  const token = req.get('x-csrf-token') || req.body?._csrf;
  if (!token || token !== req.session?.csrfToken) {
    logger.warn('Rejected logout with invalid CSRF token.');
    return res.status(403).redirect('/login?error=state_mismatch');
  }
  const userId = req.session.user?.id;
  req.session.destroy(() => {
    logger.info('Admin logged out of dashboard.', { userId });
    res.redirect('/login');
  });
});

// Legacy GET logout endpoint intentionally disabled.
router.get('/logout', (_req, res) => {
  res.status(405).redirect('/login');
});

module.exports = router;
