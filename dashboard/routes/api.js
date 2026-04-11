const express = require('express');
const { ActivityType } = require('discord.js');
const requireAuth = require('../middleware/requireAuth');
const { getSetting, setSetting, colorIntToHex } = require('../../utils/dynamicConfig');
const { getValue, setValue } = require('../../utils/database');
const logger = require('../../logger')('dashboard:api');

const router = express.Router();
router.use(requireAuth);

// ─── Helpers ────────────────────────────────────────────────────────────────

const ACTIVITY_TYPE_MAP = {
  playing:   ActivityType.Playing,
  streaming: ActivityType.Streaming,
  listening: ActivityType.Listening,
  watching:  ActivityType.Watching,
  competing: ActivityType.Competing,
  custom:    ActivityType.Custom,
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
    muteModeEnabled, muteModeKickTimeHours,
    spamModeEnabled, spamModeThreshold, spamModeWindowHours, spamModeChannelId,
    trollModeEnabled, trollModeAccountAge,
    notextChannel, reminderChannel, reminderRole,
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
    getValue('mute_mode_enabled'),
    getValue('mute_mode_kick_time_hours'),
    getValue('spam_mode_enabled'),
    getValue('spam_mode_threshold'),
    getValue('spam_mode_window_hours'),
    getValue('spam_mode_channel_id'),
    getValue('troll_mode_enabled'),
    getValue('troll_mode_account_age'),
    getValue('notext_channel'),
    getValue('reminder_channel'),
    getValue('reminder_role'),
  ]);

  return {
    bot_status:       botStatus   || '',
    bot_status_type:  botStatusType || 'watching',
    base_embed_color: baseEmbedColor != null ? colorIntToHex(baseEmbedColor) : '#999999',
    give_perms_fren_role_id:             givePermsFrenRoleId             || '',
    give_perms_position_above_role_id:   givePermsPositionAboveRoleId    || '',
    newuser_been_in_server_before_role_id: newuserBeenRoleId             || '',
    newuser_permission_diff_role_id:     newuserPermDiffRoleId           || '',
    noobies_role_id:    noobiesRoleId    || '',
    guild_name:         guildName        || 'Da Frens',
    log_level:          logLevel         || 'info',
    server_invite_url:  serverInviteUrl  || '',
    mute_mode_enabled:        muteModeEnabled      ?? false,
    mute_mode_kick_time_hours: muteModeKickTimeHours ?? 2,
    spam_mode_enabled:        spamModeEnabled      ?? false,
    spam_mode_threshold:      spamModeThreshold    ?? 3,
    spam_mode_window_hours:   spamModeWindowHours  ?? 4,
    spam_mode_channel_id:     spamModeChannelId    || '',
    troll_mode_enabled:       trollModeEnabled     ?? false,
    troll_mode_account_age:   trollModeAccountAge  ?? 30,
    notext_channel:     notextChannel    || '',
    reminder_channel:   reminderChannel  || '',
    reminder_role:      reminderRole     || '',
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

  // DB-backed settings (mute mode, spam mode, troll mode, channels, roles)
  const dbKeys = [
    'mute_mode_enabled', 'mute_mode_kick_time_hours',
    'spam_mode_enabled', 'spam_mode_threshold', 'spam_mode_window_hours', 'spam_mode_channel_id',
    'troll_mode_enabled', 'troll_mode_account_age',
    'notext_channel', 'reminder_channel', 'reminder_role',
  ];
  const numericDbKeys = new Set(['mute_mode_kick_time_hours', 'spam_mode_threshold', 'spam_mode_window_hours', 'troll_mode_account_age']);
  for (const key of dbKeys) {
    if (key in body) {
      let val = body[key];
      if (val === 'true')  val = true;
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
