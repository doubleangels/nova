const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ActivityType, PermissionFlagsBits } = require('discord.js');
const requireAuth = require('../middleware/requireAuth');
const { getSetting, setSetting, colorIntToHex } = require('../../utils/dynamicConfig');
const {
  getValue,
  setValue,
  getAllInviteTagsData,
  getAllLastMessageTimes,
  setInviteTag,
  deleteInviteTag,
  setInviteNotificationChannel,
  getInviteNotificationChannel,
  invalidateConfigCache,
  invalidateConfigCacheKey
} = require('../../utils/database');
const { getKeyvForNamespace } = require('../../utils/dbScriptUtils');
const {
  runSeedLastMessages,
  DEFAULT_MAX_PER_CHANNEL,
  DEFAULT_DELAY_MS
} = require('../../utils/seedLastMessagesFromHistory');
const {
  parseBackupPayload,
  validateNovaKeyvBackup,
  applyNovaKeyvBackupEntries
} = require('../../utils/novaKeyvBackup');
const { 
  getLatestReminderData, 
  handleReminder, 
  NEEDAFRIEND_REMINDER_MS 
} = require('../../utils/reminderUtils');
const {
  getSqlitePath,
  getStorageReport,
  runSqliteMaintenance,
  sqliteIntegrityCheck,
  cleanupExpiredSessions,
  clearAllSessionRows,
  sqliteRwProbe,
  buildDiagnosticsBundle
} = require('../../utils/maintenanceService');
const logger = require('../../logger')('dashboard:api');
const { redditApiRequest, isRedditConfigured } = require('../../utils/redditClient');

/**
 * Extended diagnostics for GET /api/health/deep.
 * @param {import('discord.js').Client} client
 */
function buildDeepHealthPayload(client) {
  const integrity = sqliteIntegrityCheck();
  const rw = sqliteRwProbe();
  const sqlitePath = getSqlitePath();
  let fileBytes = 0;
  try {
    if (fs.existsSync(sqlitePath)) fileBytes = fs.statSync(sqlitePath).size;
  } catch {
    /* ignore */
  }
  const guild = client.guilds.cache.first();
  return {
    timestamp: new Date().toISOString(),
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      pid: process.pid,
      node: process.version,
      platform: `${os.platform()} ${os.release()}`
    },
    memory: {
      rssMb: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
      heapUsedMb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
    },
    discord: {
      ready: client.isReady(),
      user: client.user ? { tag: client.user.tag, id: client.user.id } : null,
      ping: client.ws.ping,
      wsStatus: client.ws.status,
      guilds: client.guilds.cache.size,
      primaryGuild: guild
        ? { id: guild.id, name: guild.name, approximateMemberCount: guild.memberCount }
        : null
    },
    sqlite: {
      path: sqlitePath,
      fileBytes,
      integrityCheck: integrity.ok ? 'ok' : integrity.result || integrity.error || 'unknown',
      integrityOk: integrity.ok,
      readable: rw.readable,
      writable: rw.writable
    }
  };
}

/** Rolling sample for process CPU % (wall time between /api/health calls). */
let _healthCpuPrev = process.cpuUsage();
let _healthCpuWallPrev = Date.now();

/**
 * CPU time used by this Node process vs wall time since last sample (0–100 ≈ one core).
 * @returns {number}
 */
function sampleProcessCpuPercent() {
  const wall = Date.now();
  const elapsedUs = Math.max(1, (wall - _healthCpuWallPrev) * 1000);
  const diff = process.cpuUsage(_healthCpuPrev);
  _healthCpuPrev = process.cpuUsage();
  _healthCpuWallPrev = wall;
  const coreUs = diff.user + diff.system;
  return Math.min(100, Math.max(0, (coreUs / elapsedUs) * 100));
}

const router = express.Router();
router.use(requireAuth);

function getDashboardActor(req) {
  return req.session?.user?.username || req.session?.user?.id || 'unknown-user';
}

router.use((req, res, next) => {
  const startedAt = Date.now();
  const actor = getDashboardActor(req);
  logger.debug('Dashboard API request started.', {
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
      logger.error('Dashboard API request completed with a server error.', payload);
      return;
    }
    if (res.statusCode >= 400) {
      logger.warn('Dashboard API request completed with a client error.', payload);
      return;
    }
    logger.debug('Dashboard API request completed successfully.', payload);
  });

  next();
});

router.use(async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const guild = req.discordClient?.guilds?.cache?.first();
    if (!userId || !guild) {
      return res.status(403).json({ error: 'Dashboard access denied.' });
    }
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return res.status(403).json({ error: 'Dashboard access denied.' });
    }
    if (
      !member.permissions.has(PermissionFlagsBits.Administrator) &&
      !member.permissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      return res.status(403).json({ error: 'Administrator permissions required.' });
    }
    next();
  } catch (err) {
    logger.error('Failed dashboard authorization re-check.', { err });
    return res.status(403).json({ error: 'Dashboard access denied.' });
  }
});

const INACTIVITY_KICK_REASON =
    'Inactivity - We kick members who are inactive; we want an active community more than a large one! Feel free to rejoin if you wish!';

/** Permissions granted beyond the @everyone baseline (avoids marking everyone "mod" when @everyone is permissive). */
function elevatedMemberPermissions(member) {
    try {
        const everyone = member.guild?.roles?.everyone;
        if (!everyone) return member.permissions;
        return member.permissions.remove(everyone.permissions);
    } catch {
        return member.permissions;
    }
}

/** @param {import('discord.js').GuildMember} member */
function memberPrivilegeLevel(member) {
    const perms = elevatedMemberPermissions(member);
    if (
        perms.has(PermissionFlagsBits.Administrator) ||
        perms.has(PermissionFlagsBits.ManageGuild)
    ) {
        return 'admin';
    }
    const modFlags = [
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageNicknames,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.MoveMembers
    ];
    if (modFlags.some((f) => perms.has(f))) return 'mod';
    return null;
}

const USER_SUMMARY_CACHE_MS = 120 * 1000;
/** @type {{ guildId: string, expires: number, data: { total: number, bots: number, humans: number, recent: unknown[] } } | null} */
let userSummaryCacheEntry = null;

function invalidateUserSummaryCache() {
  userSummaryCacheEntry = null;
}

/** Shared in-flight fetch promise only (avoid retaining full member collections in memory). */
/** @type {{ guildId: string, promise: Promise<import('discord.js').Collection<string, import('discord.js').GuildMember>> } | null} */
let guildMembersInflight = null;

async function fetchGuildMembersCached(guild, { force = false } = {}) {
    const gid = guild.id;
    if (!force && guildMembersInflight && guildMembersInflight.guildId === gid) {
        return guildMembersInflight.promise;
    }
    const promise = guild.members.fetch();
    guildMembersInflight = { guildId: gid, promise };
    try {
        return await promise;
    } finally {
        if (guildMembersInflight?.promise === promise) {
            guildMembersInflight = null;
        }
    }
}

function invalidateGuildMembersCache() {
    guildMembersInflight = null;
}

/** REST: guild.invites.fetch() is easy to 429 when the dashboard refreshes often. */
const INVITES_LIST_CACHE_MS = 90 * 1000;
/** @type {{ guildId: string, expires: number, data: unknown[] } | null} */
let invitesListCacheEntry = null;

const DEFAULT_REDDIT_PROMOTION_LINK = 'https://discord.gg/j5sfQtCVSU';
const DEFAULT_REDDIT_PROMOTION_TITLE = '🐸 Da Frens (21+) | High-energy gaming, top-tier banter, and a strict "no lurkers" policy.';
const DEFAULT_REDDIT_PROMOTION_BODY = `**🐸 Welcome to Da Frens!**

*Where the banter is sharp, the games are sweaty, and the vibes are unmatched.*`;
const DEFAULT_REDDIT_PROMOTION_SUBREDDITS = ['discordservers_', 'DiscordPromote', 'DiscordServerPromos'];
/** Flair hint (substring match) used only when migrating legacy settings into `reddit_promotion_targets`. */
const LEGACY_PROMOTION_FLAIR_HINTS = {
  discordservers_: 'gaming',
  DiscordPromote: 'gaming server',
  DiscordServerPromos: 'multiple categories [please list in post description]'
};
const DEFAULT_NEEDAFRIEND_SUBREDDIT = 'needafriend';
const DEFAULT_NEEDAFRIEND_THREAD_TITLE = 'Weekly Discord Server Advertisement Thread';
const DEFAULT_NEEDAFRIEND_COMMENT = `🐸 Da Frens | 21+ High-Energy Banter & Gaming
Join the chaos: https://discord.gg/Z9rYazqCA6`;
const DEFAULT_REMINDER_BUMP_DELAY_MS = 2 * 60 * 60 * 1000;
const DEFAULT_REMINDER_PROMOTE_DELAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REMINDER_NEEDAFRIEND_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

function parseJsonList(val, fallback) {
  if (!val) return fallback;
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(String(val));
    if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    /* ignore */
  }
  return fallback;
}

function toIntOrDefault(val, fallback, min, max) {
  const n = parseInt(String(val), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizePromotionSubredditName(name) {
  return String(name || '')
    .trim()
    .replace(/^r\//i, '')
    .replace(/[^A-Za-z0-9_]/g, '');
}

function looksUnsafeRegex(pattern) {
  const src = String(pattern || '');
  if (src.length > 160) return true;
  if (/(\\\d|\\k<)/.test(src)) return true;
  if (/\((?:[^()]|\\.)*[+*{](?:[^()]|\\.)*\)[+*{]/.test(src)) return true;
  if (/(\.\*|\.\+)[+*{]/.test(src)) return true;
  return false;
}

/**
 * Validates dashboard input for /promote targets (per subreddit: link + flair selection).
 * @param {unknown} val
 * @returns {Array<{ subreddit: string, url: string, flair_text: string, flair_template_id: string }>}
 */
function validateAndNormalizeRedditPromotionTargets(val) {
  let parsed = val;
  if (typeof val === 'string') {
    try {
      parsed = JSON.parse(val);
    } catch {
      throw new Error('reddit_promotion_targets must be valid JSON.');
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error('reddit_promotion_targets must be a JSON array.');
  }
  if (parsed.length > 25) {
    throw new Error('Too many promotion targets (max 25).');
  }
  const out = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const sub = normalizePromotionSubredditName(row.subreddit);
    if (!sub || sub.length > 50) continue;
    const url = String(row.url || row.link || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const flairHint = String(row.flair_text || row.flairText || '').trim().slice(0, 200);
    const flairTemplateId = String(row.flair_template_id || row.flairTemplateId || '')
      .trim()
      .slice(0, 64);
    out.push({ subreddit: sub, url, flair_text: flairHint, flair_template_id: flairTemplateId });
  }
  return out;
}

/**
 * @param {string | null} rawTargets
 * @param {string} legacyLink
 * @param {unknown} legacySubsRaw
 * @returns {string} JSON array string for the dashboard
 */
function buildRedditPromotionTargetsJsonForDashboard(rawTargets, legacyLink, legacySubsRaw) {
  if (rawTargets) {
    let p = rawTargets;
    if (typeof rawTargets === 'string') {
      try {
        p = JSON.parse(rawTargets);
      } catch {
        p = null;
      }
    }
    if (Array.isArray(p) && p.length > 0) {
      return JSON.stringify(p);
    }
  }
  const subs = parseJsonList(legacySubsRaw, DEFAULT_REDDIT_PROMOTION_SUBREDDITS);
  const link = String(legacyLink || DEFAULT_REDDIT_PROMOTION_LINK).trim();
  const rows = subs.map((sub) => ({
    subreddit: sub,
    url: link,
    title: '',
    body: '',
    flair_text: LEGACY_PROMOTION_FLAIR_HINTS[sub] || '',
    flair_template_id: ''
  }));
  return JSON.stringify(rows);
}

function invalidateInvitesListCache() {
  invitesListCacheEntry = null;
}

/** Dashboard-only: backfill last_message keys from channel history (one job at a time). */
let seedJobRunning = false;
/** @type {string | null} */
let currentSeedJobId = null;
/** @type {AbortController | null} */
let currentSeedAbortController = null;
/** @type {Map<string, object>} */
const seedJobs = new Map();

function pruneOldSeedJobs() {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000;
  for (const [id, job] of seedJobs) {
    if (job.finishedAt && now - job.finishedAt > maxAge) seedJobs.delete(id);
  }
}

/**
 * @param {object} job
 * @param {object} evt
 */
function applySeedJobProgress(job, evt) {
  if (evt.percent != null) job.percent = evt.percent;
  if (evt.type === 'start') {
    job.channelsTotal = evt.channelsTotal;
    job.guildName = evt.guildName;
  }
  if (evt.type === 'channel_start' || evt.type === 'channel_batch' || evt.type === 'channel_done') {
    job.channelIndex = evt.channelIndex;
    job.channelsTotal = evt.channelsTotal;
    job.currentChannelName = evt.channelName;
    if (evt.messagesScanned != null) job.messagesScanned = evt.messagesScanned;
    if (evt.usersTracked != null) job.usersTracked = evt.usersTracked;
  }
  if (evt.type === 'write_start') {
    job.messagesScanned = evt.messagesScanned;
    job.usersTracked = evt.usersTracked;
    job.usersToWrite = evt.usersToWrite;
  }
  if (evt.type === 'write_progress') {
    job.usersUpdated = evt.usersUpdated;
    job.usersSkipped = evt.usersSkipped;
    job.writeIndex = evt.writeIndex;
    job.writesTotal = evt.writesTotal;
  }
  if (evt.type === 'done' && evt.result) {
    const r = evt.result;
    job.result = r;
    job.messagesScanned = r.messagesScanned;
    job.usersTracked = r.usersTracked;
    job.usersUpdated = r.usersUpdated;
    job.usersSkipped = r.usersSkipped;
    job.channelErrors = r.channelErrors;
  }
}

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

/**
 * Deletes a raw Keyv row by full key.
 * @param {string} fullKey - The raw key as stored in SQLite.
 */
async function deleteRawDatabaseEntry(fullKey) {
  const Database = require('better-sqlite3');
  const dataDir = process.env.DATA_DIR || require('path').resolve(process.cwd(), 'data');
  const sqlitePath = require('path').join(dataDir, 'database.sqlite');
  const db = new Database(sqlitePath);
  db.prepare('DELETE FROM keyv WHERE key = ?').run(fullKey);
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
    notextChannel, reminderChannel, reminderRole, pruneProtectedRoleId,
    dashboardPort, dashboardBaseUrl, dashboardCookieSecure,
    inviteNotificationChannel,
    redditPromotionTargetsRaw,
    redditPromotionLink, redditPromotionTitle, redditPromotionBody, redditPromotionSubreddits,
    needafriendSubreddit, needafriendThreadTitle, needafriendComment,
    reminderBumpDelayMs, reminderPromoteDelayMs, reminderNeedafriendDelayMs
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
    getValue('prune_protected_role_id'),
    getValue('dashboard_port'),
    getValue('dashboard_base_url'),
    getValue('dashboard_cookie_secure'),
    getInviteNotificationChannel(),
    getValue('reddit_promotion_targets'),
    getValue('reddit_promotion_link'),
    getValue('reddit_promotion_title'),
    getValue('reddit_promotion_body'),
    getValue('reddit_promotion_subreddits'),
    getValue('needafriend_subreddit'),
    getValue('needafriend_thread_title'),
    getValue('needafriend_comment'),
    getValue('reminder_delay_bump_ms'),
    getValue('reminder_delay_promote_ms'),
    getValue('reminder_delay_needafriend_ms')
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
    invite_notification_channel: inviteNotificationChannel || '',
    prune_protected_role_id: pruneProtectedRoleId || '',
    dashboard_port: dashboardPort ?? 3001,
    dashboard_base_url: dashboardBaseUrl || '',
    dashboard_cookie_secure: dashboardCookieSecure === true || dashboardCookieSecure === 'true',
    reddit_promotion_targets: buildRedditPromotionTargetsJsonForDashboard(
      redditPromotionTargetsRaw,
      redditPromotionLink,
      redditPromotionSubreddits
    ),
    reddit_promotion_link: String(redditPromotionLink || DEFAULT_REDDIT_PROMOTION_LINK),
    reddit_promotion_title: String(redditPromotionTitle || DEFAULT_REDDIT_PROMOTION_TITLE),
    reddit_promotion_body: String(redditPromotionBody || DEFAULT_REDDIT_PROMOTION_BODY),
    reddit_promotion_subreddits: parseJsonList(redditPromotionSubreddits, DEFAULT_REDDIT_PROMOTION_SUBREDDITS).join(', '),
    needafriend_subreddit: String(needafriendSubreddit || DEFAULT_NEEDAFRIEND_SUBREDDIT),
    needafriend_thread_title: String(needafriendThreadTitle || DEFAULT_NEEDAFRIEND_THREAD_TITLE),
    needafriend_comment: String(needafriendComment || DEFAULT_NEEDAFRIEND_COMMENT),
    reminder_delay_bump_ms: toIntOrDefault(reminderBumpDelayMs, DEFAULT_REMINDER_BUMP_DELAY_MS, 60000, 30 * 24 * 60 * 60 * 1000),
    reminder_delay_promote_ms: toIntOrDefault(reminderPromoteDelayMs, DEFAULT_REMINDER_PROMOTE_DELAY_MS, 60000, 30 * 24 * 60 * 60 * 1000),
    reminder_delay_needafriend_ms: toIntOrDefault(reminderNeedafriendDelayMs, DEFAULT_REMINDER_NEEDAFRIEND_DELAY_MS, 60000, 30 * 24 * 60 * 60 * 1000)
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

// ─── GET /api/reddit/link-flair ────────────────────────────────────────────
/** Lists link (post) flair templates for a subreddit (OAuth; same account as /promote). */
router.get('/reddit/link-flair', async (req, res) => {
  const sub = normalizePromotionSubredditName(req.query.subreddit);
  if (!sub) {
    return res.status(400).json({ error: 'Invalid subreddit name.' });
  }
  if (!isRedditConfigured()) {
    return res.status(503).json({ error: 'Reddit API is not configured on this bot.' });
  }
  try {
    const flairData = await redditApiRequest('GET', `/r/${sub}/api/link_flair`);
    if (!Array.isArray(flairData)) {
      return res.json({ flairs: [] });
    }
    const flairs = flairData
      .map((f) => {
        const id = f.id ?? f.flair_template_id ?? f.flair_identifier;
        if (id == null || id === '') return null;
        const text = String(f.text ?? f.flair_text ?? '').trim() || '(no label)';
        return { id: String(id), text };
      })
      .filter(Boolean);
    res.json({ flairs });
  } catch (err) {
    logger.error('Reddit link_flair fetch failed.', { err, subreddit: sub });
    const status = err.response?.status;
    const clientErr =
      status === 403 ||
      status === 404 ||
      (err.message && String(err.message).includes('SUBREDDIT'));
    const msg = clientErr
      ? `Could not load flairs for r/${sub}. It may be private, banned, or not found.`
      : 'Failed to load flairs from Reddit.';
    res.status(clientErr ? 400 : 500).json({ error: msg });
  }
});

// ─── POST /api/settings ────────────────────────────────────────────────

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
    'notext_channel', 'reminder_channel', 'reminder_role', 'prune_protected_role_id',
    'dashboard_port', 'dashboard_base_url', 'dashboard_cookie_secure',
    'invite_notification_channel',
    'reddit_promotion_targets',
    'reddit_promotion_link', 'reddit_promotion_title', 'reddit_promotion_body', 'reddit_promotion_subreddits',
    'needafriend_subreddit', 'needafriend_thread_title', 'needafriend_comment',
    'reminder_delay_bump_ms', 'reminder_delay_promote_ms', 'reminder_delay_needafriend_ms'
  ];
  const numericDbKeys = new Set([
    'dashboard_port',
    'reminder_delay_bump_ms',
    'reminder_delay_promote_ms',
    'reminder_delay_needafriend_ms'
  ]);
  for (const key of dbKeys) {
    if (key in body) {
      let val = body[key];
      if (val === 'true') val = true;
      if (val === 'false') val = false;
      if (key === 'reddit_promotion_targets') {
        try {
          val = validateAndNormalizeRedditPromotionTargets(val);
        } catch (e) {
          return res.status(400).json({ error: e.message || 'Invalid reddit promotion targets.' });
        }
      }
      if (key === 'reddit_promotion_subreddits') {
        val = parseJsonList(String(val).split(',').map((v) => v.trim()).filter(Boolean), DEFAULT_REDDIT_PROMOTION_SUBREDDITS);
      }
      if (key === 'reddit_promotion_link' || key === 'needafriend_subreddit') {
        val = String(val || '').trim();
      }
      if (key === 'reddit_promotion_title' || key === 'needafriend_thread_title') {
        val = String(val || '').trim().slice(0, 300);
      }
      if (key === 'reddit_promotion_body' || key === 'needafriend_comment') {
        val = String(val || '').trim().slice(0, 15000);
      }
      if (numericDbKeys.has(key)) val = Number(val);
      if (key === 'reminder_delay_bump_ms') val = toIntOrDefault(val, DEFAULT_REMINDER_BUMP_DELAY_MS, 60000, 30 * 24 * 60 * 60 * 1000);
      if (key === 'reminder_delay_promote_ms') val = toIntOrDefault(val, DEFAULT_REMINDER_PROMOTE_DELAY_MS, 60000, 30 * 24 * 60 * 60 * 1000);
      if (key === 'reminder_delay_needafriend_ms') val = toIntOrDefault(val, DEFAULT_REMINDER_NEEDAFRIEND_DELAY_MS, 60000, 30 * 24 * 60 * 60 * 1000);
      if (key === 'invite_notification_channel') {
        ops.push(setInviteNotificationChannel(val || null));
      } else {
        ops.push(setValue(key, val));
      }
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

// ─── GET /api/permissions/summary ────────────────────────────────────────────
router.get('/permissions/summary', async (req, res) => {
  try {
    const guild = req.discordClient?.guilds?.cache?.first();
    if (!guild) return res.status(503).json({ error: 'Bot guild not available.' });

    const members = await fetchGuildMembersCached(guild, { force: false });
    let admins = 0;
    let mods = 0;
    let bots = 0;
    for (const m of members.values()) {
      if (m.user.bot) bots += 1;
      const level = memberPrivilegeLevel(m);
      if (level === 'admin') admins += 1;
      else if (level === 'mod') mods += 1;
    }

    const keyPermCounts = {
      manageRoles: 0,
      manageChannels: 0,
      banMembers: 0,
      kickMembers: 0
    };
    for (const m of members.values()) {
      const p = elevatedMemberPermissions(m);
      if (p.has(PermissionFlagsBits.ManageRoles)) keyPermCounts.manageRoles += 1;
      if (p.has(PermissionFlagsBits.ManageChannels)) keyPermCounts.manageChannels += 1;
      if (p.has(PermissionFlagsBits.BanMembers)) keyPermCounts.banMembers += 1;
      if (p.has(PermissionFlagsBits.KickMembers)) keyPermCounts.kickMembers += 1;
    }

    res.json({
      members: members.size,
      bots,
      admins,
      mods,
      keyPermissionHolders: keyPermCounts
    });
  } catch (err) {
    logger.error('Failed to build permissions summary.', { err });
    res.status(500).json({ error: 'Failed to build permissions summary.' });
  }
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

// ─── GET /api/database/export ───────────────────────────────────────────────
/** Full Keyv table backup as downloadable JSON (requires dashboard auth). */
router.get('/database/export', (req, res) => {
  try {
    const entries = getRawDatabaseEntries();
    const pkg = require('../../package.json');
    const payload = {
      format: 'nova-keyv-backup',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      app: { name: pkg.name, version: pkg.version },
      entryCount: entries.length,
      entries
    };
    const body = JSON.stringify(payload, null, 2);
    const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `nova-database-backup-${safeStamp}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logger.info('Database JSON export downloaded.', {
      user: req.session.user?.username,
      entryCount: entries.length
    });
    res.send(body);
  } catch (err) {
    logger.error('Failed to export database.', { err });
    res.status(500).json({ error: 'Failed to export database.' });
  }
});

// ─── POST /api/database/import/validate ─────────────────────────────────────
/** Validates a backup JSON object without writing to the database. */
router.post('/database/import/validate', (req, res) => {
  const raw = req.body && req.body.backup != null ? req.body.backup : null;
  if (raw == null) {
    return res.status(400).json({ error: 'Missing "backup" in request body.' });
  }

  const parsed = parseBackupPayload(typeof raw === 'string' ? raw : raw);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  const result = validateNovaKeyvBackup(parsed.payload);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  const nsCounts = {};
  for (const { fullKey } of result.entries) {
    const ns = fullKey.split(':')[0] || 'main';
    nsCounts[ns] = (nsCounts[ns] || 0) + 1;
  }

  logger.info('Database backup JSON validated (dry run).', {
    user: req.session.user?.username,
    entryCount: result.entries.length,
    warnings: result.warnings.length
  });

  res.json({
    ok: true,
    entryCount: result.entries.length,
    namespaces: nsCounts,
    warnings: result.warnings
  });
});

// ─── POST /api/database/import ──────────────────────────────────────────────
/**
 * Validates then applies a Keyv backup (upsert). Set dryRun: true to only validate
 * (same checks as /import/validate; no writes).
 */
router.post('/database/import', (req, res) => {
  const raw = req.body && req.body.backup != null ? req.body.backup : null;
  if (raw == null) {
    return res.status(400).json({ error: 'Missing "backup" in request body.' });
  }

  const dryRun = req.body.dryRun === true || req.body.dryRun === 'true';

  const parsed = parseBackupPayload(typeof raw === 'string' ? raw : raw);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  const result = validateNovaKeyvBackup(parsed.payload);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  if (dryRun) {
    logger.info('Database backup import dry run (no writes).', {
      user: req.session.user?.username,
      entryCount: result.entries.length
    });
    return res.json({
      ok: true,
      dryRun: true,
      imported: 0,
      entryCount: result.entries.length,
      warnings: result.warnings
    });
  }

  try {
    const { written } = applyNovaKeyvBackupEntries(result.entries);
    invalidateConfigCache();
    invalidateUserSummaryCache();
    invalidateGuildMembersCache();
    invalidateInvitesListCache();

    logger.info('Database backup imported from JSON.', {
      user: req.session.user?.username,
      written,
      warnings: result.warnings.length
    });

    res.json({
      ok: true,
      dryRun: false,
      imported: written,
      warnings: result.warnings
    });
  } catch (err) {
    logger.error('Failed to import database backup.', { err });
    res.status(500).json({ error: 'Failed to import database backup.' });
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
    if (String(fullKey).startsWith('main:config:')) {
      invalidateConfigCacheKey(String(fullKey).replace('main:config:', ''));
    }
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

// ─── DELETE /api/database/raw ───────────────────────────────────────────────

router.delete('/database/raw', async (req, res) => {
  const { fullKey } = req.body;
  const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
  if (!fullKey) {
    return res.status(400).json({ error: 'Missing fullKey in request body.' });
  }

  try {
    if (dryRun) {
      return res.json({ ok: true, dryRun: true, fullKey, action: 'delete_raw_key' });
    }
    await deleteRawDatabaseEntry(fullKey);
    if (String(fullKey).startsWith('main:config:')) {
      invalidateConfigCacheKey(String(fullKey).replace('main:config:', ''));
    }
    logger.info('Raw database entry deleted via dashboard.', {
      fullKey,
      user: req.session.user?.username
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to delete raw database entry.', { err, fullKey });
    res.status(500).json({ error: 'Failed to delete database entry.' });
  }
});

// ─── GET /api/health ────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    const cpuPercent = sampleProcessCpuPercent();
    const load = os.loadavg();
    const cpuSubtitle =
      process.platform === 'win32'
        ? 'Node process'
        : `1m load ${load[0].toFixed(2)}`;

    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const guild = req.discordClient.guilds.cache.first();

    res.json({
      cpu: {
        percent: Number(cpuPercent.toFixed(1)),
        subtitle: cpuSubtitle,
      },
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

// ─── GET /api/health/deep ───────────────────────────────────────────────────
/** Process, Discord gateway, and SQLite diagnostics (Maintenance). */
router.get('/health/deep', (req, res) => {
  try {
    const client = req.discordClient;
    if (!client) {
      return res.status(503).json({ error: 'Discord client not available.' });
    }
    res.json(buildDeepHealthPayload(client));
  } catch (err) {
    logger.error('Failed to build deep health.', { err });
    res.status(500).json({ error: 'Failed to fetch deep health.' });
  }
});

// ─── GET /api/maintenance/diagnostics/export ────────────────────────────────
router.get('/maintenance/diagnostics/export', async (req, res) => {
  try {
    const client = req.discordClient;
    const deep = client ? buildDeepHealthPayload(client) : {};
    const storage = getStorageReport();
    const safeSettings = {
      bot_status: await getSetting('bot_status'),
      bot_status_type: await getSetting('bot_status_type'),
      base_embed_color: colorIntToHex((await getSetting('base_embed_color')) || 0x999999),
      log_level: await getSetting('log_level')
    };
    const idSettings = {
      reminder_channel: await getValue('reminder_channel'),
      reminder_role: await getValue('reminder_role'),
      notext_channel: await getValue('notext_channel'),
      prune_protected_role_id: await getValue('prune_protected_role_id')
    };
    const activeJob = currentSeedJobId ? seedJobs.get(currentSeedJobId) || null : null;
    const bundle = buildDiagnosticsBundle({
      deepHealth: deep,
      storageReport: storage,
      activeJob,
      cacheKeys: ['user_summary', 'guild_members', 'invites'],
      safeSettings,
      idSettings
    });
    const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `nova-diagnostics-${safeStamp}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logger.info('Diagnostics bundle exported from dashboard.', { user: req.session.user?.username });
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    logger.error('Failed to export diagnostics bundle.', { err });
    res.status(500).json({ error: 'Failed to export diagnostics bundle.' });
  }
});

// ─── GET /api/reminders/live ────────────────────────────────────────────────
router.get('/reminders/live', async (req, res) => {
  try {
    const [bump, promote, needafriend] = await Promise.all([
      getLatestReminderData('bump'),
      getLatestReminderData('promote'),
      getLatestReminderData('needafriend')
    ]);
    res.json({
      bump: bump?.remind_at || null,
      promote: promote?.remind_at || null,
      needafriend: needafriend?.remind_at || null
    });
  } catch (err) {
    logger.error('Failed to fetch live reminders.', { err });
    res.status(500).json({ error: 'Failed to fetch live reminders.' });
  }
});

// ─── POST /api/reminders/fix ────────────────────────────────────────────────
router.post('/reminders/fix', async (req, res) => {
  const { type } = req.body;
  if (!['bump', 'promote', 'needafriend'].includes(type)) {
    return res.status(400).json({ error: 'Invalid reminder type.' });
  }

  try {
    // Delays are configurable via dashboard settings with sane defaults.
    let delayMs = toIntOrDefault(await getValue('reminder_delay_bump_ms'), DEFAULT_REMINDER_BUMP_DELAY_MS, 60000, 30 * 24 * 60 * 60 * 1000);
    if (type === 'promote') {
      delayMs = toIntOrDefault(await getValue('reminder_delay_promote_ms'), DEFAULT_REMINDER_PROMOTE_DELAY_MS, 60000, 30 * 24 * 60 * 60 * 1000);
    }
    if (type === 'needafriend') {
      delayMs = toIntOrDefault(await getValue('reminder_delay_needafriend_ms'), NEEDAFRIEND_REMINDER_MS, 60000, 30 * 24 * 60 * 60 * 1000);
    }

    // We need a mock message-like object that has the client attached
    // req.app.get('client') is where the discord client is stored
    const client = req.app.get('client');
    await handleReminder({ client }, delayMs, type, true);
    
    res.json({ success: true, message: `Fixed ${type} reminder.` });
  } catch (err) {
    logger.error(`Failed to fix ${type} reminder.`, { err });
    res.status(500).json({ error: 'Failed to fix reminder.' });
  }
});

// ─── GET /api/fun/auto-reactions ───────────────────────────────────────────
router.get('/fun/auto-reactions', async (req, res) => {
  try {
    const reactions = await getValue('auto_reactions') || [];
    res.json(reactions);
  } catch (err) {
    logger.error('Failed to fetch auto-reactions.', { err });
    res.status(500).json({ error: 'Failed to fetch auto-reactions.' });
  }
});

// ─── POST /api/fun/auto-reactions ──────────────────────────────────────────
router.post('/fun/auto-reactions', async (req, res) => {
  const { reactions } = req.body;
  if (!Array.isArray(reactions)) {
    return res.status(400).json({ error: 'Reactions must be an array.' });
  }

  try {
    // Basic validation
    const cleaned = reactions
      .filter(r => r.regex && r.emoji)
      .map(r => ({
        regex: String(r.regex).trim(),
        emoji: String(r.emoji).trim()
      }))
      .filter((r) => r.regex.length > 0 && r.emoji.length > 0);
    if (cleaned.some((r) => looksUnsafeRegex(r.regex))) {
      return res.status(400).json({ error: 'One or more regex patterns are too complex/unsafe.' });
    }
    for (const r of cleaned) {
      try {
        // Validate syntax now so runtime message pipeline cannot crash on malformed entries.
        new RegExp(r.regex, 'i');
      } catch {
        return res.status(400).json({ error: `Invalid regex pattern: ${r.regex}` });
      }
    }

    await setValue('auto_reactions', cleaned);
    logger.info('Auto-reactions updated via dashboard.', {
      count: cleaned.length,
      user: req.session.user?.username
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to update auto-reactions.', { err });
    res.status(500).json({ error: 'Failed to update auto-reactions.' });
  }
});

// ─── POST /api/messages/send ────────────────────────────────────────────────
router.post('/messages/send', async (req, res) => {
  const { channelId, isEmbed, content, embedData } = req.body || {};
  if (!channelId) return res.status(400).json({ error: 'Missing channelId.' });
  try {
    const guild = req.discordClient?.guilds?.cache?.first();
    if (!guild) return res.status(503).json({ error: 'Bot guild not available.' });
    const channel =
      guild.channels.cache.get(String(channelId)) ||
      await guild.channels.fetch(String(channelId)).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      return res.status(400).json({ error: 'Invalid or non-text channel.' });
    }
    if (isEmbed) {
      const title = String(embedData?.title || '').trim().slice(0, 256);
      const description = String(embedData?.description || '').trim().slice(0, 4000);
      if (!title && !description) {
        return res.status(400).json({ error: 'Embed must include a title or description.' });
      }
      const colorRaw = String(embedData?.color || '').trim();
      const color = /^#[0-9a-f]{6}$/i.test(colorRaw) ? parseInt(colorRaw.slice(1), 16) : 0x999999;
      const embed = { color, title, description };
      const thumbnail = String(embedData?.thumbnail || '').trim();
      const footer = String(embedData?.footer || '').trim().slice(0, 2048);
      if (thumbnail) embed.thumbnail = { url: thumbnail };
      if (footer) embed.footer = { text: footer };
      await channel.send({ embeds: [embed] });
    } else {
      const safeContent = String(content || '').trim();
      if (!safeContent) return res.status(400).json({ error: 'Message content is empty.' });
      await channel.send({ content: safeContent.slice(0, 2000) });
    }
    return res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to send dashboard message.', { err });
    return res.status(500).json({ error: 'Failed to send message.' });
  }
});

// ─── GET /api/invites ────────────────────────────────────────────────────────
router.get('/invites', async (req, res) => {
  try {
    const guild = req.discordClient.guilds.cache.first();
    if (!guild) return res.status(503).json({ error: 'Guild not available.' });

    const forceRefresh =
      req.query.refresh === '1' ||
      req.query.refresh === 'true' ||
      req.query.refresh === 'yes';
    const now = Date.now();
    if (
      !forceRefresh &&
      invitesListCacheEntry &&
      invitesListCacheEntry.guildId === guild.id &&
      invitesListCacheEntry.expires > now
    ) {
      return res.json(invitesListCacheEntry.data);
    }

    const invites = await guild.invites.fetch();
    const tags = await getAllInviteTagsData();

    // Create a map for quick lookup
    const tagMap = {};
    tags.forEach(t => { tagMap[t.code.toLowerCase()] = t.tagName; });

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

    invitesListCacheEntry = {
      guildId: guild.id,
      expires: now + INVITES_LIST_CACHE_MS,
      data: result
    };

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
    const channel =
      guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId));

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

    invalidateInvitesListCache();
    res.json({ ok: true, code: invite.code });
  } catch (err) {
    logger.error('Failed to create invite.', { err });
    res.status(500).json({ error: 'Failed to create invite.' });
  }
});

// ─── DELETE /api/invites/:code ──────────────────────────────────────────────
router.delete('/invites/:code', async (req, res) => {
  const { code } = req.params;
  const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
  try {
    const guild = req.discordClient.guilds.cache.first();
    if (dryRun) {
      const invite = (await guild.invites.fetch()).find((i) => i.code === code);
      return res.json({
        ok: true,
        dryRun: true,
        action: 'revoke_invite',
        exists: Boolean(invite),
        code
      });
    }
    await guild.invites.delete(code, `Deleted via Dashboard by ${req.session.user?.username}`);

    // Also cleanup tag if exists
    await deleteInviteTag(guild.id, code);

    invalidateInvitesListCache();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to delete invite.', { err, code });
    res.status(500).json({ error: 'Failed to delete invite.' });
  }
});

// ─── POST /api/invites/tag ──────────────────────────────────────────────────
router.post('/invites/tag', async (req, res) => {
  const { code, tag } = req.body;
  const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
  if (!code) return res.status(400).json({ error: 'Missing code.' });

  try {
    const guild = req.discordClient.guilds.cache.first();
    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        action: tag ? 'set_invite_tag' : 'delete_invite_tag',
        code,
        tag: tag || null
      });
    }
    if (tag) {
      await setInviteTag(guild.id, code, tag);
    } else {
      await deleteInviteTag(guild.id, code);
    }
    invalidateInvitesListCache();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to update invite tag.', { err, code });
    res.status(500).json({ error: 'Failed to update invite tag.' });
  }
});

// ─── GET /api/users/summary ──────────────────────────────────────────────────
router.get('/users/summary', async (req, res) => {
    const forceRefresh =
        req.query.refresh === '1' ||
        req.query.refresh === 'true' ||
        req.query.refresh === 'yes';
    const guild = req.discordClient.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Guild not found' });

    const now = Date.now();
    if (
        !forceRefresh &&
        userSummaryCacheEntry &&
        userSummaryCacheEntry.guildId === guild.id &&
        userSummaryCacheEntry.expires > now
    ) {
        return res.json({ ...userSummaryCacheEntry.data, cached: true, stale: false });
    }

    try {
        const safeRoleId = String((await getValue('prune_protected_role_id')) || '').trim();

        const members = await fetchGuildMembersCached(guild, { force: forceRefresh });
        const activityMap = await getAllLastMessageTimes();

        const sortedMembers = Array.from(members.values())
            .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp)
            .map(m => {
                let lastMsg = activityMap[m.id];
                if (lastMsg != null && typeof lastMsg !== 'number') lastMsg = Number(lastMsg);
                if (lastMsg != null && Number.isNaN(lastMsg)) lastMsg = null;

                return {
                    id: m.id,
                    username: m.user.username,
                    displayName: m.displayName,
                    avatar: m.user.displayAvatarURL({ size: 64 }),
                    joinedAt: m.joinedAt,
                    isBot: Boolean(m.user.bot),
                    hasSafeRole: Boolean(safeRoleId && m.roles.cache.has(safeRoleId)),
                    privilege: memberPrivilegeLevel(m),
                    lastMessageAt: lastMsg == null ? null : lastMsg
                };
            });

        const data = {
            total: members.size,
            bots: members.filter(m => m.user.bot).size,
            humans: members.filter(m => !m.user.bot).size,
            recent: sortedMembers
        };

        const nowTs = Date.now();
        const activeBuckets = { under1d: 0, under7d: 0, under30d: 0, over30d: 0, noData: 0 };
        for (const m of sortedMembers) {
          if (m.isBot) continue;
          if (!m.lastMessageAt) {
            activeBuckets.noData += 1;
            continue;
          }
          const ageDays = Math.floor((nowTs - Number(m.lastMessageAt)) / (24 * 60 * 60 * 1000));
          if (ageDays < 1) activeBuckets.under1d += 1;
          else if (ageDays < 7) activeBuckets.under7d += 1;
          else if (ageDays < 30) activeBuckets.under30d += 1;
          else activeBuckets.over30d += 1;
        }
        data.activityInsights = {
          trackedHumans: data.humans - activeBuckets.noData,
          noDataHumans: activeBuckets.noData,
          buckets: activeBuckets,
          generatedAt: new Date().toISOString()
        };

        userSummaryCacheEntry = {
            guildId: guild.id,
            expires: now + USER_SUMMARY_CACHE_MS,
            data
        };

        res.json({ ...data, cached: false, stale: false });
    } catch (e) {
        const isGatewayRateLimit =
            e?.name === 'GatewayRateLimitError' ||
            (typeof e?.message === 'string' && e.message.toLowerCase().includes('rate limit'));
        if (isGatewayRateLimit && userSummaryCacheEntry?.guildId === guild.id && userSummaryCacheEntry?.data) {
            const retryMs = Math.round((e?.data?.retry_after || 20) * 1000);
            const bump = Math.max(USER_SUMMARY_CACHE_MS, retryMs);
            userSummaryCacheEntry.expires = Math.max(userSummaryCacheEntry.expires, now + bump);
            logger.warn('API /users/summary gateway rate limited; returning cached roster', {
                retry_after: e?.data?.retry_after
            });
            return res.json({ ...userSummaryCacheEntry.data, cached: true, stale: true });
        }
        logger.error('API /users/summary error', { err: e });
        res.status(500).json({ error: e.message });
    }
});

// ─── GET /api/users/inactivity/dry-run ───────────────────────────────────────
router.get('/users/inactivity/dry-run', async (req, res) => {
    try {
        const guild = req.discordClient.guilds.cache.first();
        if (!guild) return res.status(500).json({ error: 'Guild not found' });
        
        const days = parseInt(req.query.days) || 30;
        let excludedRole = String(req.query.excludedRole || '').trim();
        if (!excludedRole) excludedRole = (await getValue('prune_protected_role_id')) || '';
        
        const inactivityThresholdMs = days * 24 * 60 * 60 * 1000;
        const now = Date.now();
        
        const members = await fetchGuildMembersCached(guild, { force: false });
        const activityMap = await getAllLastMessageTimes();
        
        const inactivityTargets = [];
        members.forEach(m => {
            if (m.user.bot) return;
            if (excludedRole && m.roles.cache.has(excludedRole)) return;

            const lastActivity = activityMap[m.id];

            if (lastActivity) {
                if (now - lastActivity > inactivityThresholdMs) {
                    inactivityTargets.push({
                        id: m.id,
                        username: m.user.username,
                        displayName: m.displayName,
                        reason: 'Inactive (no recent messages)'
                    });
                }
            } else {
                const joinTs = m.joinedTimestamp || 0;
                if (now - joinTs > inactivityThresholdMs) {
                    inactivityTargets.push({
                        id: m.id,
                        username: m.user.username,
                        displayName: m.displayName,
                        reason: 'Inactive (no recorded activity since join)'
                    });
                }
            }
        });

        res.json({ targetCount: inactivityTargets.length, targets: inactivityTargets });
    } catch (e) {
        logger.error('API /users/inactivity/dry-run error', { err: e });
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/users/inactivity/execute ──────────────────────────────────────
router.post('/users/inactivity/execute', async (req, res) => {
    try {
        const guild = req.discordClient.guilds.cache.first();
        if (!guild) return res.status(500).json({ error: 'Guild not found' });
        
        const days = parseInt(req.body.days) || 30;
        let excludedRole = String(req.body.excludedRole || '').trim();
        if (!excludedRole) excludedRole = (await getValue('prune_protected_role_id')) || '';
        
        const inactivityThresholdMs = days * 24 * 60 * 60 * 1000;
        const now = Date.now();
        
        const members = await fetchGuildMembersCached(guild, { force: true });
        const activityMap = await getAllLastMessageTimes();
        
        const inactivityTargets = [];
        members.forEach(m => {
            if (m.user.bot) return;
            if (excludedRole && m.roles.cache.has(excludedRole)) return;
            if (m.id === guild.ownerId) return;

            const botRolePos = guild.members.resolve(req.discordClient.user.id).roles.highest.position;
            if (m.roles.highest.position >= botRolePos) return;

            const lastActivity = activityMap[m.id];
            if (lastActivity) {
                if (now - lastActivity > inactivityThresholdMs) inactivityTargets.push(m);
            } else {
                const joinTs = m.joinedTimestamp || 0;
                if (now - joinTs > inactivityThresholdMs) inactivityTargets.push(m);
            }
        });

        if (inactivityTargets.length === 0) {
            return res.json({ success: true, kicked: 0, failed: 0 });
        }

        // We run kicks synchronously with 250ms sleep to avoid Discord API 429
        let kicked = 0;
        let failed = 0;
        for (const m of inactivityTargets) {
            try {
                await m.kick(INACTIVITY_KICK_REASON);
                kicked++;
            } catch (kErr) {
                failed++;
            }
            await new Promise(r => setTimeout(r, 250));
        }

        invalidateGuildMembersCache();
        invalidateUserSummaryCache();

        res.json({ success: true, kicked, failed });
    } catch (e) {
        logger.error('API /users/inactivity/execute error', { err: e });
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/users/:userId/kick ────────────────────────────────────────────
router.post('/users/:userId/kick', async (req, res) => {
  try {
    const guild = req.discordClient.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Guild not found' });

    const userId = String(req.params.userId || '').trim();
    if (!userId) return res.status(400).json({ error: 'Missing user id.' });

    const target = await guild.members.fetch(userId).catch(() => null);
    if (!target) return res.status(404).json({ error: 'Member not found.' });
    if (target.user.bot) return res.status(400).json({ error: 'Cannot kick bot accounts from this panel.' });
    if (target.id === guild.ownerId) return res.status(400).json({ error: 'Cannot kick the server owner.' });

    const botMember = guild.members.resolve(req.discordClient.user.id);
    if (!botMember) return res.status(500).json({ error: 'Bot member not found.' });
    if (target.roles.highest.position >= botMember.roles.highest.position) {
      return res.status(403).json({ error: 'Target role is above or equal to the bot role.' });
    }

    const reason = String(req.body?.reason || '').trim() || `Kicked via Dashboard by ${req.session.user?.username || 'unknown user'}`;
    await target.kick(reason);

    invalidateGuildMembersCache();
    invalidateUserSummaryCache();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to kick member from dashboard.', { err, userId: req.params.userId });
    res.status(500).json({ error: 'Failed to kick member.' });
  }
});

// ─── POST /api/users/:userId/ban ─────────────────────────────────────────────
router.post('/users/:userId/ban', async (req, res) => {
  try {
    const guild = req.discordClient.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Guild not found' });

    const userId = String(req.params.userId || '').trim();
    if (!userId) return res.status(400).json({ error: 'Missing user id.' });

    const target = await guild.members.fetch(userId).catch(() => null);
    if (!target) return res.status(404).json({ error: 'Member not found.' });
    if (target.user.bot) return res.status(400).json({ error: 'Cannot ban bot accounts from this panel.' });
    if (target.id === guild.ownerId) return res.status(400).json({ error: 'Cannot ban the server owner.' });

    const botMember = guild.members.resolve(req.discordClient.user.id);
    if (!botMember) return res.status(500).json({ error: 'Bot member not found.' });
    if (target.roles.highest.position >= botMember.roles.highest.position) {
      return res.status(403).json({ error: 'Target role is above or equal to the bot role.' });
    }

    const reason = String(req.body?.reason || '').trim() || `Banned via Dashboard by ${req.session.user?.username || 'unknown user'}`;
    await target.ban({ reason, deleteMessageSeconds: 0 });

    invalidateGuildMembersCache();
    invalidateUserSummaryCache();
    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to ban member from dashboard.', { err, userId: req.params.userId });
    res.status(500).json({ error: 'Failed to ban member.' });
  }
});

// ─── GET /api/maintenance/seed-last-messages/active ─────────────────────────
router.get('/maintenance/seed-last-messages/active', (_req, res) => {
  res.json({ active: seedJobRunning, jobId: currentSeedJobId });
});

// ─── GET /api/maintenance/jobs/:id ──────────────────────────────────────────
router.get('/maintenance/jobs/:id', (req, res) => {
  const job = seedJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(job);
});

// ─── POST /api/maintenance/seed-last-messages/stop ──────────────────────────
router.post('/maintenance/seed-last-messages/stop', (req, res) => {
  if (!seedJobRunning || !currentSeedJobId || !currentSeedAbortController) {
    return res.status(409).json({ error: 'No active backfill job to stop.' });
  }
  const job = seedJobs.get(currentSeedJobId);
  if (job) {
    job.stopRequested = true;
  }
  currentSeedAbortController.abort();
  logger.warn('Dashboard requested stop for seed last messages job.', {
    jobId: currentSeedJobId,
    user: req.session.user?.username
  });
  res.json({ ok: true, jobId: currentSeedJobId, stopping: true });
});

// ─── POST /api/maintenance/seed-last-messages ───────────────────────────────
router.post('/maintenance/seed-last-messages', (req, res) => {
  if (seedJobRunning) {
    return res.status(409).json({ error: 'A backfill job is already running.', jobId: currentSeedJobId });
  }
  const guild = req.discordClient?.guilds?.cache?.first();
  if (!guild) return res.status(503).json({ error: 'Bot guild not available.' });

  pruneOldSeedJobs();
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    type: 'seed_last_messages',
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    percent: 0,
    guildName: guild.name,
    channelsTotal: 0,
    channelIndex: 0,
    currentChannelName: null,
    messagesScanned: 0,
    usersTracked: 0,
    usersToWrite: 0,
    writeIndex: 0,
    writesTotal: 0,
    usersUpdated: 0,
    usersSkipped: 0,
    channelErrors: [],
    result: null
  };
  seedJobs.set(jobId, job);

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const maxPerChannel = Math.min(
    50000,
    Math.max(100, parseInt(String(body.maxPerChannel), 10) || DEFAULT_MAX_PER_CHANNEL)
  );
  const delayMs = Math.min(5000, Math.max(0, parseInt(String(body.delayMs), 10) || DEFAULT_DELAY_MS));
  const dryRun = body.dryRun === true || body.dryRun === 'true';
  let channelIds = null;
  if (Array.isArray(body.channelIds) && body.channelIds.length > 0) {
    channelIds = body.channelIds.map((id) => String(id).trim()).filter(Boolean);
  }

  seedJobRunning = true;
  currentSeedJobId = jobId;
  currentSeedAbortController = new AbortController();

  const username = req.session.user?.username;
  const keyv = getKeyvForNamespace('main');

  res.json({ jobId, started: true });

  (async () => {
    try {
      const result = await runSeedLastMessages({
        guild,
        keyv,
        maxPerChannel,
        delayMs,
        channelIds,
        dryRun,
        signal: currentSeedAbortController.signal,
        onProgress: async (evt) => {
          applySeedJobProgress(job, evt);
        }
      });
      if (job.stopRequested) {
        job.status = 'stopped';
        job.finishedAt = Date.now();
        job.error = 'Stopped by user.';
        logger.warn('Dashboard seed last messages stopped.', { jobId, user: username });
      } else {
        job.status = 'done';
        job.percent = 100;
        job.result = result;
        job.finishedAt = Date.now();
        logger.info('Dashboard seed last messages completed.', {
          jobId,
          user: username,
          messagesScanned: result.messagesScanned,
          usersUpdated: result.usersUpdated
        });
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        job.status = 'stopped';
        job.error = 'Stopped by user.';
        job.finishedAt = Date.now();
        logger.warn('Dashboard seed last messages aborted.', { jobId, user: username });
      } else {
        job.status = 'error';
        job.error = err && err.message ? String(err.message) : String(err);
        job.finishedAt = Date.now();
        logger.error('Dashboard seed last messages failed.', { jobId, err });
      }
    } finally {
      await keyv.disconnect().catch(() => {});
      seedJobRunning = false;
      currentSeedJobId = null;
      currentSeedAbortController = null;
    }
  })();
});

// ─── GET /api/maintenance/storage-report ────────────────────────────────────
router.get('/maintenance/storage-report', (req, res) => {
  try {
    const report = getStorageReport();
    res.json(report);
  } catch (err) {
    logger.error('Storage report failed.', { err });
    res.status(500).json({ error: 'Failed to build storage report.' });
  }
});

// ─── POST /api/maintenance/sqlite ───────────────────────────────────────────
/** Body: { operation: 'analyze' | 'vacuum' | 'optimize' } */
router.post('/maintenance/sqlite', (req, res) => {
  const op = req.body && String(req.body.operation || '').toLowerCase();
  const result = runSqliteMaintenance(op);
  if (!result.ok) {
    logger.warn('SQLite maintenance failed.', { operation: op, err: result.error });
    return res.status(400).json({ ok: false, error: result.error, operation: op });
  }
  logger.info('SQLite maintenance completed.', {
    operation: op,
    user: req.session.user?.username,
    fileBytesBefore: result.fileBytesBefore,
    fileBytesAfter: result.fileBytesAfter
  });
  res.json({ ok: true, ...result });
});

// ─── POST /api/maintenance/cleanup ──────────────────────────────────────────
/** Body: { dryRun?: boolean, target: 'expired_sessions' } */
router.post('/maintenance/cleanup', (req, res) => {
  const target = req.body && req.body.target;
  if (target !== 'expired_sessions') {
    return res.status(400).json({ error: 'Unsupported cleanup target.' });
  }
  const dryRun = req.body.dryRun === true || req.body.dryRun === 'true';
  try {
    const result = cleanupExpiredSessions(dryRun);
    logger.info('Session cleanup.', {
      dryRun,
      ...result,
      user: req.session.user?.username
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Cleanup failed.', { err });
    res.status(500).json({ error: err.message || 'Cleanup failed.' });
  }
});

// ─── POST /api/maintenance/sessions/clear-all ───────────────────────────────
/** Destroys all dashboard sessions in Keyv (everyone must log in again). Body: { confirm: 'CLEAR_ALL_SESSIONS' } */
router.post('/maintenance/sessions/clear-all', (req, res) => {
  const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
  if (dryRun) {
    try {
      const preview = cleanupExpiredSessions(true);
      return res.json({ ok: true, dryRun: true, estimatedActiveSessionRows: preview.scanned });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to preview session clear.' });
    }
  }
  if (req.body?.confirm !== 'CLEAR_ALL_SESSIONS') {
    return res.status(400).json({
      error: 'Confirmation required: send { "confirm": "CLEAR_ALL_SESSIONS" }.'
    });
  }
  try {
    const { deleted } = clearAllSessionRows();
    logger.warn('All dashboard sessions cleared from database.', {
      deleted,
      user: req.session.user?.username
    });
    res.json({ ok: true, deleted });
  } catch (err) {
    logger.error('Clear sessions failed.', { err });
    res.status(500).json({ error: err.message || 'Failed to clear sessions.' });
  }
});

// ─── POST /api/maintenance/discord/resync ───────────────────────────────────
router.post('/maintenance/discord/resync', async (req, res) => {
  const guild = req.discordClient?.guilds?.cache?.first();
  if (!guild) return res.status(503).json({ error: 'Bot guild not available.' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const channels = body.channels !== false;
  const roles = body.roles !== false;
  try {
    if (channels) await guild.channels.fetch();
    if (roles) await guild.roles.fetch();
    invalidateUserSummaryCache();
    invalidateGuildMembersCache();
    invalidateInvitesListCache();
    logger.info('Discord cache resync completed.', {
      channels,
      roles,
      user: req.session.user?.username
    });
    res.json({ ok: true, channels, roles });
  } catch (err) {
    logger.error('Discord resync failed.', { err });
    res.status(500).json({ error: err.message || 'Resync failed.' });
  }
});

// ─── POST /api/maintenance/cache/clear ──────────────────────────────────────
router.post('/maintenance/cache/clear', (req, res) => {
  const raw = req.body?.targets;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : ['all'];
  const cleared = [];

  if (list.includes('all')) {
    invalidateUserSummaryCache();
    invalidateGuildMembersCache();
    invalidateInvitesListCache();
    cleared.push('user_summary', 'guild_members', 'invites');
    logger.info('Dashboard cleared all API caches.', { user: req.session.user?.username });
    return res.json({ ok: true, cleared });
  }

  if (list.includes('user_summary')) {
    invalidateUserSummaryCache();
    cleared.push('user_summary');
  }
  if (list.includes('guild_members')) {
    invalidateGuildMembersCache();
    cleared.push('guild_members');
  }
  if (list.includes('invites')) {
    invalidateInvitesListCache();
    cleared.push('invites');
  }

  logger.info('Dashboard cleared API caches.', { cleared, user: req.session.user?.username });
  res.json({ ok: true, cleared });
});

module.exports = router;
