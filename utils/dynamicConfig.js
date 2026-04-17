const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Lazy-require to avoid circular dependencies (database.js imports config.js)
let _getValue, _setValue;
function db() {
  if (!_getValue) ({ getValue: _getValue, setValue: _setValue } = require('./database'));
  return { getValue: _getValue, setValue: _setValue };
}

// Lazy-require config so we can mutate it in-place after DB load
let _config;
function cfg() {
  if (!_config) _config = require('../config');
  return _config;
}

// In-memory cache for synchronous reads (populated at startup via seedAllFromEnv)
const cache = new Map();

/**
 * Maps snake_case DB keys to camelCase config property names.
 * Only non-sensitive values that can be edited from the dashboard.
 */
const CONFIG_PROPERTY_MAP = {
  bot_status: 'botStatus',
  bot_status_type: 'botStatusType',
  base_embed_color: 'baseEmbedColor',
  give_perms_fren_role_id: 'givePermsFrenRoleId',
  give_perms_position_above_role_id: 'givePermsPositionAboveRoleId',
  newuser_been_in_server_before_role_id: 'newUserBeenInServerBeforeRoleId',
  newuser_permission_diff_role_id: 'newUserPermissionDiffRoleId',
  noobies_role_id: 'noobiesRoleId',
  guild_name: 'guildName',
  log_level: 'logLevel',
  server_invite_url: 'serverInviteUrl',
};

/** All keys managed by this module. */
const SETTINGS_KEYS = Object.keys(CONFIG_PROPERTY_MAP);

/**
 * Coerces a raw DB value to the correct JavaScript type for a given key.
 * @param {string} key
 * @param {*} value
 */
function coerce(key, value) {
  if (value === null || value === undefined) return value;
  if (key === 'base_embed_color') {
    if (typeof value === 'number') return value;
    const cleaned = String(value).trim().replace(/^#/, '').replace(/^0x/i, '');
    const parsed = parseInt(cleaned, 16);
    return isNaN(parsed) ? 0x999999 : parsed;
  }
  return value;
}

/**
 * Converts a stored embed color integer back to a #RRGGBB hex string for display.
 * @param {number} colorInt
 * @returns {string}
 */
function colorIntToHex(colorInt) {
  return `#${(colorInt >>> 0).toString(16).padStart(6, '0').toUpperCase()}`;
}

/**
 * Applies a value to both the cache and the live config object so all existing
 * code that reads `config.someProperty` sees the update without any file changes.
 */
function applyToBoth(key, value) {
  cache.set(key, value);
  const prop = CONFIG_PROPERTY_MAP[key];
  if (prop) cfg()[prop] = value;
}

/**
 * Synchronous read from the in-memory cache.
 * Returns null if seedAllFromEnv() has not yet been called.
 * @param {string} key
 * @returns {*}
 */
function getSettingSync(key) {
  return cache.has(key) ? cache.get(key) : null;
}

/**
 * Async read. Checks the cache first, then falls back to the database.
 * @param {string} key
 * @returns {Promise<*>}
 */
async function getSetting(key) {
  if (cache.has(key)) return cache.get(key);
  try {
    const { getValue } = db();
    const val = await getValue(key);
    if (val != null) {
      const coerced = coerce(key, val);
      applyToBoth(key, coerced);
      return coerced;
    }
  } catch (err) {
    logger.error('Failed to read dynamic config setting.', { key, err });
  }
  return null;
}

/**
 * Writes a setting to the cache, the live config object, and the database.
 * @param {string} key
 * @param {*} value
 */
async function setSetting(key, value) {
  const coerced = coerce(key, value);
  try {
    const { setValue } = db();
    await setValue(key, coerced);
    applyToBoth(key, coerced);
  } catch (err) {
    logger.error('Failed to persist dynamic config setting.', { key, err });
    throw err;
  }
}

/**
 * Seeds a single setting from an env-var value.
 * If the DB already has a value it takes priority (dashboard override wins over env).
 * @param {string} key
 * @param {*} envValue
 */
async function seedFromEnv(key, envValue) {
  try {
    const { getValue, setValue } = db();
    const existing = await getValue(key);
    if (existing != null) {
      applyToBoth(key, coerce(key, existing));
      return;
    }
    if (envValue != null && String(envValue).trim() !== '') {
      const coerced = coerce(key, envValue);
      applyToBoth(key, coerced);
      await setValue(key, coerced);
    }
  } catch (err) {
    logger.error('Failed to seed dynamic config from env.', { key, err });
  }
}

/**
 * Seeds all non-sensitive settings from environment variables on startup.
 * Call this once in ready.js after initializeDatabase().
 * DB values always win over env vars so dashboard changes survive restarts.
 */
async function seedAllFromEnv() {
  const seeds = [
    ['bot_status', process.env.BOT_STATUS],
    ['bot_status_type', process.env.BOT_STATUS_TYPE],
    ['base_embed_color', process.env.BASE_EMBED_COLOR],
    ['give_perms_fren_role_id', process.env.GIVE_PERMS_FREN_ROLE_ID],
    ['give_perms_position_above_role_id', process.env.GIVE_PERMS_POSITION_ABOVE_ROLE_ID],
    ['newuser_been_in_server_before_role_id', process.env.NEWUSER_BEEN_IN_SERVER_BEFORE_ROLE_ID],
    ['newuser_permission_diff_role_id', process.env.NEWUSER_PERMISSION_DIFF_ROLE_ID],
    ['noobies_role_id', process.env.NOOBIES_ROLE_ID],
    ['guild_name', process.env.GUILD_NAME || 'Da Frens'],
    ['log_level', process.env.LOG_LEVEL || 'info'],
    ['server_invite_url', process.env.SERVER_INVITE_URL],
  ];
  await Promise.all(seeds.map(([key, val]) => seedFromEnv(key, val)));
  logger.info('Dynamic config seeded — non-sensitive settings loaded from DB / env.');
}

module.exports = {
  SETTINGS_KEYS,
  CONFIG_PROPERTY_MAP,
  colorIntToHex,
  getSettingSync,
  getSetting,
  setSetting,
  seedAllFromEnv,
};
