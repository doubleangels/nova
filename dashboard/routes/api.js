const express = require('express');
const os = require('os');
const path = require('path');
const { ActivityType } = require('discord.js');
const requireAuth = require('../middleware/requireAuth');
const { getSetting, setSetting, colorIntToHex } = require('../../utils/dynamicConfig');
const { getValue, setValue, getAllInviteTagsData } = require('../../utils/database');
const logger = require('../../logger')('dashboard:api');

const router = express.Router();
router.use(requireAuth);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Reads all raw key-value entries from the SQLite database.
 * Uses better-sqlite3 directly to access Keyv's underlying table.
 * @returns {Array<{fullKey: string, namespace: string, key: string, value: any}>}
 */
function getRawDatabaseEntries() {
  const Database = require('better-sqlite3');
  const dataDir = process.env.DATA_DIR || require('path').resolve(process.cwd(), 'data');
  const sqlitePath = require('path').join(dataDir, 'database.sqlite');
  const db = new Database(sqlitePath, { readonly: true });
  const rows = db.prepare('SELECT key, value FROM keyv').all();
  db.close();
  return rows.map(row => {
    let value;
    try {
      const parsed = JSON.parse(row.value);
      value = parsed?.value !== undefined ? parsed.value : parsed;
    } catch { value = row.value; }
    // key format: "namespace:rest" or just "key"
    const colonIdx = row.key.indexOf(':');
    const namespace = colonIdx > -1 ? row.key.slice(0, colonIdx) : 'main';
    const key = colonIdx > -1 ? row.key.slice(colonIdx + 1) : row.key;
    return { fullKey: row.key, namespace, key, value };
  });
}
/**
 * Writes a JSON value back to a raw Keyv row by full key.
 * @param {string} fullKey - The raw key as stored in SQLite (e.g. 'main:config:foo')
 * @param {any} value - The new value (will be JSON-encoded in Keyv format)
 */
async function updateRawDatabaseEntry(fullKey, value) {
  const Database = require('better-sqlite3');
  const dataDir = process.env.DATA_DIR || require('path').resolve(process.cwd(), 'data');
  const sqlitePath = require('path').join(dataDir, 'database.sqlite');
  const db = new Database(sqlitePath);
  const encoded = JSON.stringify({ value, expires: null });
  db.prepare('UPDATE keyv SET value = ? WHERE key = ?').run(encoded, fullKey);
  db.close();
}

const ACTIVITY_TYPE_MAP = {
  playing: ActivityType.Playing,
  streaming: ActivityType.Streaming,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
};

/** Updates the bot's live Discord presence after a status change. */
function applyBotStatus(client, status, statusType) {
  if (!client?.user) return;
  const type = ACTIVITY_TYPE_MAP[String(statusType).toLowerCase()] ?? ActivityType.Watching;
  client.user.setActivity(status || 'for ways to help! ❤️', { type });
}

/**
 * Reads ALL settings (dynamic config + DB-backed) and returns them as a flat object.
 * Color is returned as a #RRGGBB hex string for the color picker.
 */
async function readAllSettings() {
  const [
    botStatus, botStatusType, baseEmbedColor,
    givePermsFrenRoleId, givePermsPositionAboveRoleId,
    newuserBeenRoleId, newuserPermDiffRoleId,
    noobiesRoleId, guildName, logLevel, serverInviteUrl,
    notextChannel, reminderChannel, reminderRole,
    dashboardPort, dashboardBaseUrl, dashboardCookieSecure,
  ] = await Promise.all([
    getSetting('bot_status'),
    getSetting('bot_status_type'),
    getSetting('base_embed_color'),
    getSetting('give_perms_fren_role_id'),
    getSetting('give_perms_position_above_role_id'),
    getSetting('newuser_been_in_server_before_role_id'),
    getSetting('newuser_permission_diff_role_id'),
    getSetting('noobies_role_id'),
    getSetting('guild_name'),
    getSetting('log_level'),
    getSetting('server_invite_url'),
    getValue('notext_channel'),
    getValue('reminder_channel'),
    getValue('reminder_role'),
    getValue('dashboard_port'),
    getValue('dashboard_base_url'),
    getValue('dashboard_cookie_secure'),
  ]);

  return {
    bot_status: botStatus || '',
    bot_status_type: botStatusType || 'watching',
    base_embed_color: baseEmbedColor != null ? colorIntToHex(baseEmbedColor) : '#999999',
    give_perms_fren_role_id: givePermsFrenRoleId || '',
    give_perms_position_above_role_id: givePermsPositionAboveRoleId || '',
    newuser_been_in_server_before_role_id: newuserBeenRoleId || '',
    newuser_permission_diff_role_id: newuserPermDiffRoleId || '',
    noobies_role_id: noobiesRoleId || '',
    guild_name: guildName || 'Da Frens',
    log_level: logLevel || 'info',
    server_invite_url: serverInviteUrl || '',
    notext_channel: notextChannel || '',
    reminder_channel: reminderChannel || '',
    reminder_role: reminderRole || '',
    dashboard_port: dashboardPort ?? 3001,
    dashboard_base_url: dashboardBaseUrl || '',
    dashboard_cookie_secure: dashboardCookieSecure === true || dashboardCookieSecure === 'true',
  };
}

// ─── GET /api/settings ───────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  try {
    const settings = await readAllSettings();
    res.json(settings);
  } catch (err) {
    logger.error('Failed to read settings.', { err });
    res.status(500).json({ error: 'Failed to read settings.' });
  }
});

// ─── POST /api/settings ──────────────────────────────────────────────────────

router.post('/settings', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  const ops = [];

  // Dynamic config settings (these also mutate the live config object)
  const dynamicKeys = [
    'bot_status', 'bot_status_type', 'base_embed_color',
    'give_perms_fren_role_id', 'give_perms_position_above_role_id',
    'newuser_been_in_server_before_role_id', 'newuser_permission_diff_role_id',
    'noobies_role_id', 'guild_name', 'log_level', 'server_invite_url',
  ];
  for (const key of dynamicKeys) {
    if (key in body) ops.push(setSetting(key, body[key]));
  }

  // DB-backed settings (channels, roles)
  const dbKeys = [
    'notext_channel', 'reminder_channel', 'reminder_role',
    'dashboard_port', 'dashboard_base_url', 'dashboard_cookie_secure',
  ];
  const numericDbKeys = new Set(['dashboard_port']);
  for (const key of dbKeys) {
    if (key in body) {
      let val = body[key];
      if (val === 'true') val = true;
      if (val === 'false') val = false;
      if (numericDbKeys.has(key)) val = Number(val);
      ops.push(setValue(key, val));
    }
  }

  try {
    await Promise.all(ops);

    // Apply live bot status change if either field was updated
    if ('bot_status' in body || 'bot_status_type' in body) {
      const [status, statusType] = await Promise.all([
        getSetting('bot_status'),
        getSetting('bot_status_type'),
      ]);
      applyBotStatus(req.discordClient, status, statusType);
      logger.info('Bot status updated live.', { status, statusType });
    }

    logger.info('Dashboard settings saved.', {
      updatedKeys: Object.keys(body),
      user: req.session.user?.username,
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to save settings.', { err });
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// ─── GET /api/guild/roles ────────────────────────────────────────────────────

router.get('/guild/roles', (req, res) => {
  const guild = req.discordClient?.guilds?.cache?.first();
  if (!guild) return res.status(503).json({ error: 'Bot guild not available.' });

  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id) // exclude @everyone
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

  res.json(roles);
});

// ─── GET /api/guild/channels ─────────────────────────────────────────────────

router.get('/guild/channels', (req, res) => {
  const guild = req.discordClient?.guilds?.cache?.first();
  if (!guild) return res.status(503).json({ error: 'Bot guild not available.' });

  const channels = guild.channels.cache
    .filter(c => c.isTextBased() && !c.isThread())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map(c => ({ id: c.id, name: c.name, type: c.type }));

  res.json(channels);
});

// ─── GET /api/me ─────────────────────────────────────────────────────────────

router.get('/me', (req, res) => {
  res.json(req.session.user);
});

module.exports = router;
// ─── GET /api/database/raw ──────────────────────────────────────────────────

router.get('/database/raw', async (req, res) => {
  try {
    const entries = await getRawDatabaseEntries();
    res.json(entries);
  } catch (err) {
    logger.error('Failed to get raw database entries.', { err });
    res.status(500).json({ error: 'Failed to retrieve database entries.' });
  }
});

// ─── POST /api/database/raw ─────────────────────────────────────────────────

router.post('/database/raw', async (req, res) => {
  const { fullKey, value } = req.body;
  if (!fullKey) {
    return res.status(400).json({ error: 'Missing fullKey in request body.' });
  }

  try {
    await updateRawDatabaseEntry(fullKey, value);
    logger.info('Raw database entry updated via dashboard.', {
      fullKey,
      user: req.session.user?.username
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to update raw database entry.', { err, fullKey });
    res.status(500).json({ error: 'Failed to update database entry.' });
  }
});

// ─── GET /api/health ────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    const uptimeSeconds = process.uptime();
    const days = Math.floor(uptimeSeconds / (3600 * 24));
    const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const guild = req.discordClient.guilds.cache.first();

    res.json({
      uptime: `${days}d ${hours}h ${minutes}m`,
      ping: req.discordClient.ws.ping,
      memory: {
        rss: (mem.rss / 1024 / 1024).toFixed(2),
        heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2),
        heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2),
        systemTotal: (totalMem / 1024 / 1024 / 1024).toFixed(2),
        systemFree: (freeMem / 1024 / 1024 / 1024).toFixed(2),
      },
      guilds: req.discordClient.guilds.cache.size,
      users: guild ? guild.memberCount : 0,
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.release()}`,
    });
  } catch (err) {
    logger.error('Failed to get health stats.', { err });
    res.status(500).json({ error: 'Failed to fetch health stats.' });
  }
});

// ─── GET /api/invites ────────────────────────────────────────────────────────
router.get('/invites', async (req, res) => {
  try {
    const guild = req.discordClient.guilds.cache.first();
    if (!guild) return res.status(503).json({ error: 'Guild not available.' });

    const invites = await guild.invites.fetch();
    const tags = await getAllInviteTagsData();

    // Create a map for quick lookup
    const tagMap = {};
    tags.forEach(t => tagMap[t.code.toLowerCase()] = t.tagName);

    const result = invites.map(inv => ({
      code: inv.code,
      channel: inv.channel?.name || 'Unknown',
      channelId: inv.channel?.id,
      inviter: inv.inviter?.username || 'System',
      uses: inv.uses,
      maxUses: inv.maxUses,
      expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
      tagName: tagMap[inv.code.toLowerCase()] || null,
      url: inv.url,
      createdAt: inv.createdAt ? inv.createdAt.toISOString() : null
    }));

    res.json(result);
  } catch (err) {
    logger.error('Failed to get invites.', { err });
    res.status(500).json({ error: 'Failed to fetch invites.' });
  }
});

// ─── POST /api/invites ───────────────────────────────────────────────────────
router.post('/invites', async (req, res) => {
  const { channelId, maxAge, maxUses, unique, tag } = req.body;
  if (!channelId) return res.status(400).json({ error: 'Missing channelId.' });

  try {
    const guild = req.discordClient.guilds.cache.first();
    const channel = await guild.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      return res.status(400).json({ error: 'Invalid or non-text channel.' });
    }

    const invite = await channel.createInvite({
      maxAge: maxAge != null ? Number(maxAge) : 0,
      maxUses: maxUses != null ? Number(maxUses) : 0,
      unique: unique === true || unique === 'true',
      reason: `Created via Dashboard by ${req.session.user?.username}`
    });

    if (tag) {
      await setInviteTag(guild.id, invite.code, tag);
    }

    res.json({ ok: true, code: invite.code });
  } catch (err) {
    logger.error('Failed to create invite.', { err });
    res.status(500).json({ error: 'Failed to create invite.' });
  }
});

// ─── DELETE /api/invites/:code ──────────────────────────────────────────────
router.delete('/invites/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const guild = req.discordClient.guilds.cache.first();
    await guild.invites.delete(code, `Deleted via Dashboard by ${req.session.user?.username}`);

    // Also cleanup tag if exists
    await deleteInviteTag(guild.id, code);

    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to delete invite.', { err, code });
    res.status(500).json({ error: 'Failed to delete invite.' });
  }
});

// ─── POST /api/invites/tag ──────────────────────────────────────────────────
router.post('/invites/tag', async (req, res) => {
  const { code, tag } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code.' });

  try {
    const guild = req.discordClient.guilds.cache.first();
    if (tag) {
      await setInviteTag(guild.id, code, tag);
    } else {
      await deleteInviteTag(guild.id, code);
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to update invite tag.', { err, code });
    res.status(500).json({ error: 'Failed to update invite tag.' });
  }
});

module.exports = router;
