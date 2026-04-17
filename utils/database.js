const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const KeyvSqlite = requireDefault('@keyv/sqlite');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const config = require('../config');
const logger = require('../logger')(path.basename(__filename));

// Ensure data directory exists with proper permissions
// Allow override via DATA_DIR so bot and helper scripts use the same DB path
const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const sqlitePath = path.join(dataDir, 'database.sqlite');

// Log database path for debugging
logger.info('Database path initialized.', {
  sqlitePath: sqlitePath
});
logger.info('Working directory retrieved.', {
  workingDirectory: process.cwd()
});
logger.info('Data directory path retrieved.', {
  dataDir: dataDir
});

try {
  if (!fs.existsSync(dataDir)) {
    // 0o750 = rwxr-x--- (owner: read/write/execute, group: read/execute, others: no access)
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o750 });
    logger.info('Created data directory.', {
      dataDir: dataDir
    });
  }
  // Ensure the directory is writable
  try {
    fs.accessSync(dataDir, fs.constants.W_OK);
    logger.debug('Data directory is writable.', {
      dataDir: dataDir
    });
  } catch (accessError) {
    logger.error('Data directory is not writable.', {
      err: accessError,
      dataDir: dataDir
    });
    logger.error('Please ensure the data directory has write permissions for the bot user.');
  }

  // Check if database file exists and log its status
  if (fs.existsSync(sqlitePath)) {
    const stats = fs.statSync(sqlitePath);
    logger.info('Database file exists.', {
      sqlitePath: sqlitePath,
      size: stats.size,
      mode: stats.mode.toString(8),
      uid: stats.uid,
      gid: stats.gid
    });
  } else {
    logger.info('Database file does not exist yet, will be created on first write.', {
      sqlitePath: sqlitePath
    });
  }
} catch (error) {
  logger.error('Failed to create or access data directory.', {
    err: error,
    dataDir: dataDir
  });
  logger.error('This is likely a permissions issue. Please check directory permissions.');
}

// Initialize Keyv with SQLite storage
// Data will be stored in ./data/database.sqlite
const keyv = new Keyv({
  store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
    table: 'keyv',
    busyTimeout: 10000
  }),
  namespace: 'main'
});

// Initialize separate Keyv instance for invites namespace
const inviteKeyv = new Keyv({
  store: new KeyvSqlite(`sqlite://${sqlitePath}`, {
    table: 'keyv',
    busyTimeout: 10000
  }),
  namespace: 'invites'
});

// Handle connection errors
keyv.on('error', err => logger.error('Keyv connection error occurred.', { err: err }));
inviteKeyv.on('error', err => logger.error('Invite Keyv connection error occurred.', { err: err }));

// Ensure database file has correct permissions if it exists
// 0o600 = rw------- (owner: read/write, group: no access, others: no access)
try {
  if (fs.existsSync(sqlitePath)) {
    fs.chmodSync(sqlitePath, 0o600);
  }
} catch (chmodError) {
  logger.warn('Could not set permissions on database file, this is OK if running as non-root.', {
    err: chmodError
  });
}

/**
 * Initializes the database connection and performs a test query
 * @throws {Error} If database connection fails after all retries
 * @returns {Promise<void>}
 */
async function initializeDatabase() {
  const MAX_RETRIES = 3;
  const INITIAL_RETRY_DELAY = 1000;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
    try {
      logger.info('Testing database connection.', {
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES
      });
      logger.debug('Database path retrieved.', {
        sqlitePath: sqlitePath
      });

      const testKey = 'db_test_key';
      const testValue = 'test_value';

      await keyv.set(testKey, testValue);
      logger.debug('Test value written to database.');

      const retrieved = await keyv.get(testKey);
      logger.debug('Test value retrieved from database.', {
        retrieved: retrieved
      });

      if (retrieved === testValue) {
        logger.info("Database connection test successful.");
        await keyv.delete(testKey);
        logger.debug("Cleaned up database test data.");

        // Verify database file exists and has data
        if (fs.existsSync(sqlitePath)) {
          const stats = fs.statSync(sqlitePath);
          logger.info('Database file verified.', {
            sqlitePath: sqlitePath,
            size: stats.size,
            exists: true
          });
          // Database file verified successfully
        } else {
          logger.warn('Database file not found after successful test.', {
            sqlitePath: sqlitePath
          });
        }

        // Ensure database file has correct permissions after creation
        // 0o600 = rw------- (owner: read/write, group: no access, others: no access)
        try {
          if (fs.existsSync(sqlitePath)) {
            fs.chmodSync(sqlitePath, 0o600);
            logger.debug('Set database file permissions to 600.');
          }
        } catch (chmodError) {
          // Non-fatal: permissions might be set by Docker entrypoint or user doesn't have permission
          logger.debug('Could not set permissions on database file.', {
            err: chmodError
          });
        }

        return;
      } else {
        throw new Error(`Database read/write test failed. Expected: ${testValue}, Got: ${retrieved}`);
      }

    } catch (err) {
      lastError = err;
      logger.error('Database connection test failed.', {
        err: err,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
        sqlitePath: sqlitePath,
        dataDirExists: fs.existsSync(dataDir),
        dbFileExists: fs.existsSync(sqlitePath)
      });

      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      retryCount++;

      if (retryCount < MAX_RETRIES) {
        logger.info('Retrying database connection.', {
          delayMs: delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error("All database connection attempts failed. Stopping bot as database connectivity is critical.");

  if (lastError) {
    logger.error("Final database error occurred.", { err: lastError });
  }

  process.exit(1);
}

// Cache for config values to avoid DB reads on hot paths (e.g. every message)
const configCache = new Map();
const messageCountLocks = new Map();

function invalidateConfigCache() {
  configCache.clear();
}

function invalidateConfigCacheKey(key) {
  configCache.delete(String(key || ''));
}

/**
 * Retrieves a configuration value from the database
 * @param {string} key - The configuration key to retrieve
 * @returns {Promise<any>} The configuration value, or null if not found
 */
async function getValue(key) {
  try {
    if (configCache.has(key)) {
      return configCache.get(key);
    }
    logger.debug('Getting config value for key.', { key: key });
    const value = await keyv.get(`config:${key}`);
    const finalValue = value !== undefined ? value : null;
    configCache.set(key, finalValue);
    return finalValue;
  } catch (err) {
    logger.error('Error occurred while getting key.', { err: err, key: key });
    return null;
  }
}

/**
 * Sets a configuration value in the database
 * @param {string} key - The configuration key to set
 * @param {any} value - The value to store
 * @returns {Promise<void>}
 */
async function setValue(key, value) {
  try {
    logger.debug('Setting config value for key.', { key: key });
    await keyv.set(`config:${key}`, value);
    configCache.set(key, value);
    logger.debug('Set config for key successfully.', { key: key });
  } catch (err) {
    logger.error('Error occurred while setting key.', { err: err, key: key });
    throw err;
  }
}

/**
 * Deletes a configuration value from the database
 * @param {string} key - The configuration key to delete
 * @returns {Promise<void>}
 */
async function deleteValue(key) {
  try {
    logger.debug('Deleting config for key.', { key: key });
    await keyv.delete(`config:${key}`);
    configCache.delete(key);
    logger.debug('Deleted config for key successfully.', { key: key });
  } catch (err) {
    logger.error('Error occurred while deleting key.', { err: err, key: key });
  }
}



/**
 * Cleans up old users from tracking if needed (placeholder for future cleanup tasks)
 * @returns {Promise<void>}
 */
async function cleanupOldTrackingUsers() {
  logger.debug('Cleanup completed, no old users found to remove.');
}

/**
 * Sets an invite tag in the invites namespace under tags: prefix
 * @param {string} tagName - The tag name (will be lowercased for storage)
 * @param {Object} inviteData - The invite data object containing code, name, createdAt, createdBy
 * @returns {Promise<void>}
 */
async function setInviteTag(tagName, inviteData) {
  try {
    logger.debug('Setting invite tag.', {
      tagName: tagName
    });
    await inviteKeyv.set(`tags:${tagName.toLowerCase()}`, inviteData);
    logger.debug('Set invite tag successfully.', {
      tagName: tagName
    });
  } catch (err) {
    logger.error('Error occurred while setting invite tag.', {
      err: err,
      tagName: tagName
    });
    throw new Error("DATABASE_WRITE_ERROR");
  }
}

/**
 * Gets an invite tag from the invites namespace under tags: prefix
 * @param {string} tagName - The tag name to retrieve
 * @returns {Promise<Object|null>} The invite data object, or null if not found
 */
async function getInviteTag(tagName) {
  try {
    logger.debug('Getting invite tag.', {
      tagName: tagName
    });
    const value = await inviteKeyv.get(`tags:${tagName.toLowerCase()}`);
    return value !== undefined ? value : null;
  } catch (err) {
    logger.error('Error occurred while getting invite tag.', {
      err: err,
      tagName: tagName
    });
    return null;
  }
}

/**
 * Deletes an invite tag from the invites namespace under tags: prefix
 * @param {string} tagName - The tag name to delete
 * @returns {Promise<void>}
 */
async function deleteInviteTag(tagName) {
  try {
    logger.debug('Deleting invite tag.', {
      tagName: tagName
    });
    await inviteKeyv.delete(`tags:${tagName.toLowerCase()}`);
    logger.debug('Deleted invite tag successfully.', {
      tagName: tagName
    });
  } catch (err) {
    logger.error('Error occurred while deleting invite tag.', {
      err: err,
      tagName: tagName
    });
    throw new Error("DATABASE_DELETE_ERROR");
  }
}

/**
 * Sets the notification channel for invite tags in the main config namespace
 * @param {string} channelId - The Discord channel ID
 * @returns {Promise<void>}
 */
async function setInviteNotificationChannel(channelId) {
  try {
    logger.debug('Setting invite notification channel.', {
      channelId: channelId
    });
    await keyv.set('config:invite_notification_channel', channelId);
    logger.debug('Set invite notification channel successfully.');
  } catch (err) {
    logger.error('Error occurred while setting invite notification channel.', {
      err: err
    });
    throw new Error("DATABASE_WRITE_ERROR");
  }
}

/**
 * Gets the notification channel for invite tags from the main config namespace
 * @returns {Promise<string|null>} The channel ID, or null if not set
 */
async function getInviteNotificationChannel() {
  try {
    logger.debug("Getting invite notification channel.");
    const value = await keyv.get('config:invite_notification_channel');
    return value !== undefined ? value : null;
  } catch (err) {
    logger.error("Error occurred while getting invite notification channel.", {
      err: err
    });
    return null;
  }
}

/**
 * Stores invite usage counts for a guild
 * @param {string} guildId - The guild ID
 * @param {Object} inviteUsage - Object mapping invite codes to their usage counts
 * @returns {Promise<void>}
 */
async function setInviteUsage(guildId, inviteUsage) {
  try {
    logger.debug('Setting invite usage for guild.', {
      guildId: guildId
    });
    await keyv.set(`invite_usage:${guildId}`, inviteUsage);
    logger.debug('Set invite usage for guild successfully.', {
      guildId: guildId
    });
  } catch (err) {
    logger.error('Error occurred while setting invite usage for guild.', {
      err: err,
      guildId: guildId
    });
  }
}

/**
 * Gets invite usage counts for a guild
 * @param {string} guildId - The guild ID
 * @returns {Promise<Object>} Object mapping invite codes to their usage counts
 */
async function getInviteUsage(guildId) {
  try {
    logger.debug('Getting invite usage for guild.', {
      guildId: guildId
    });
    const value = await keyv.get(`invite_usage:${guildId}`);
    return value || {};
  } catch (err) {
    logger.error('Error occurred while getting invite usage for guild.', {
      err: err,
      guildId: guildId
    });
    return {};
  }
}

/**
 * Stores invite code-to-tag mapping for a guild
 * @param {string} guildId - The guild ID
 * @param {Object} codeToTagMap - Object mapping invite codes (lowercase) to tag names
 * @returns {Promise<void>}
 */
async function setInviteCodeToTagMap(guildId, codeToTagMap) {
  try {
    logger.debug('Setting invite code-to-tag map for guild.', {
      guildId: guildId
    });
    await keyv.set(`invite_code_to_tag_map:${guildId}`, codeToTagMap);
    logger.debug('Set invite code-to-tag map for guild successfully.', {
      guildId: guildId
    });
  } catch (err) {
    logger.error('Error occurred while setting invite code-to-tag map for guild.', {
      err: err,
      guildId: guildId
    });
  }
}

/**
 * Gets invite code-to-tag mapping for a guild
 * @param {string} guildId - The guild ID
 * @returns {Promise<Object>} Object mapping invite codes (lowercase) to tag names
 */
async function getInviteCodeToTagMap(guildId) {
  try {
    logger.debug('Getting invite code-to-tag map for guild.', {
      guildId: guildId
    });
    const value = await keyv.get(`invite_code_to_tag_map:${guildId}`);
    return value || {};
  } catch (err) {
    logger.error('Error occurred while getting invite code-to-tag map for guild.', {
      err: err,
      guildId: guildId
    });
    return {};
  }
}


/**
 * Gets all invite tags from the invites namespace
 * This queries the SQLite database directly to get all tags
 * @returns {Promise<Array>} Array of invite tag objects with {tagName, code, name, createdAt, updatedAt}
 */
/**
 * Helper to query all raw invite tags from the SQLite database
 * @returns {Array} Array of raw rows from keyv
 */
function getRawInviteTagsRows() {
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });

  // Query all keys from invites namespace that start with tags:
  const rows = db.prepare(`
    SELECT key, value 
    FROM keyv 
    WHERE key LIKE 'invites:tags:%'
  `).all();

  db.close();
  return rows;
}

/**
 * Gets all invite tags from the invites namespace
 * This queries the SQLite database directly to get all tags
 * @returns {Promise<Array>} Array of invite tag objects with {tagName, code, name, createdAt, updatedAt}
 */
async function getAllInviteTagsData() {
  try {
    logger.debug("Getting all invite tags.");
    const rows = getRawInviteTagsRows();

    const tags = [];

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        // Keyv stores values wrapped in {value: ..., expires: null}
        const tagData = parsed?.value || parsed;

        if (tagData && tagData.code && tagData.name) {
          // Extract tag name from key (invites:tags:disboard -> disboard)
          const tagName = row.key.replace('invites:tags:', '');
          tags.push({
            tagName,
            code: tagData.code,
            name: tagData.name,
            createdAt: tagData.createdAt,
            updatedAt: tagData.updatedAt,
            createdBy: tagData.createdBy,
            updatedBy: tagData.updatedBy
          });
        }
      } catch (parseError) {
        logger.warn('Failed to parse tag data for key.', {
          err: parseError,
          key: row.key
        });
      }
    }

    return tags;
  } catch (err) {
    logger.error("Error occurred while getting all invite tags.", {
      err: err
    });
    return [];
  }
}

/**
 * Rebuilds the code-to-tag mapping from all existing invite tags
 * This queries the SQLite database directly to get all tags from the invites namespace
 * @param {string} guildId - The guild ID to rebuild the mapping for
 * @returns {Promise<Object>} The rebuilt code-to-tag mapping
 */
async function rebuildCodeToTagMap(guildId) {
  try {
    logger.debug('Rebuilding code-to-tag mapping from existing tags for guild.', {
      guildId: guildId
    });
    const rows = getRawInviteTagsRows();

    const codeToTagMap = {};

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        // Keyv stores values wrapped in {value: ..., expires: null}
        const tagData = parsed?.value || parsed;

        if (tagData && tagData.code && tagData.name) {
          // Extract tag name from key (invites:tags:disboard -> disboard)
          const tagName = row.key.replace('invites:tags:', '');
          codeToTagMap[tagData.code.toLowerCase()] = tagName;
          logger.debug('Rebuilt mapping for code to tag.', {
            code: tagData.code.toLowerCase(),
            tagName: tagName
          });
        }
      } catch (parseError) {
        logger.warn('Failed to parse tag data for key.', {
          err: parseError,
          key: row.key
        });
      }
    }

    // Save the rebuilt mapping for this guild
    if (Object.keys(codeToTagMap).length > 0) {
      await setInviteCodeToTagMap(guildId, codeToTagMap);
      logger.info('Rebuilt code-to-tag mapping for guild.', {
        guildId: guildId,
        entryCount: Object.keys(codeToTagMap).length
      });
    }

    return codeToTagMap;
  } catch (err) {
    logger.error('Error occurred while rebuilding code-to-tag mapping for guild.', {
      err: err,
      guildId: guildId
    });
    return {};
  }
}

/**
 * Gets the guild name from the database, falling back to config default
 * @returns {Promise<string>} The guild name
 */
async function getGuildName() {
  // Guild name is now read from environment variable only (GUILD_NAME)
  // No longer stored in database
  return config.guildName || 'Da Frens';
}

const FORMER_MEMBER_KEY_PREFIX = 'former_member:';

/**
 * Records that a user left the guild (so on re-join they can get the "been in server before" role).
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function setFormerMember(userId) {
  try {
    await keyv.set(`${FORMER_MEMBER_KEY_PREFIX}${userId}`, 1);
  } catch (err) {
    logger.error('Error recording former member.', { err: err, userId });
  }
}

/**
 * Increments and returns the user's total message count
 * @param {string} userId - The Discord user ID
 * @returns {Promise<number>} The updated message count
 */
async function incrementMessageCount(userId) {
  const prev = messageCountLocks.get(userId) || Promise.resolve();
  const op = prev.then(async () => {
    try {
      logger.debug('Incrementing message count for user.', { userId: userId });
      const key = `message_count:${userId}`;
      let count = await keyv.get(key) || 0;
      count++;
      await keyv.set(key, count);
      logger.debug('Incremented message count for user successfully.', {
        userId: userId,
        count: count
      });
      return count;
    } catch (error) {
      logger.error('Error incrementing message count.', { err: error, userId });
      return null;
    }
  });
  messageCountLocks.set(userId, op.finally(() => {
    if (messageCountLocks.get(userId) === op) messageCountLocks.delete(userId);
  }));
  return op;
}

/**
 * Gets the user's total message count
 * @param {string} userId - The Discord user ID
 * @returns {Promise<number>} The message count
 */
async function getMessageCount(userId) {
  try {
    const key = `message_count:${userId}`;
    return await keyv.get(key) || 0;
  } catch (error) {
    logger.error('Error getting message count.', { err: error, userId });
    return 0;
  }
}

/**
 * Deletes the user's total message count from the database
 * @param {string} userId - The Discord user ID
 * @returns {Promise<void>}
 */
async function deleteMessageCount(userId) {
  try {
    logger.debug('Deleting message count for user.', { userId: userId });
    const key = `message_count:${userId}`;
    await keyv.delete(key);
    logger.debug('Deleted message count for user successfully.', { userId: userId });
  } catch (error) {
    logger.error('Error deleting message count.', { err: error, userId });
  }
}

/**
 * Removes stale mute-mode tracking entries for a user.
 * Supports both current and legacy key names to keep cleanup resilient.
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function removeMuteModeUser(userId) {
  const keys = [
    `mute_mode:${userId}`,
    `mute_mode_user:${userId}`,
    `mute_mode:user:${userId}`
  ];
  try {
    await Promise.all(keys.map((k) => keyv.delete(k)));
  } catch (error) {
    logger.error('Error removing mute-mode user tracking.', { err: error, userId });
  }
}

/**
 * Removes stale spam-mode join-time tracking entries for a user.
 * Supports both current and legacy key names to keep cleanup resilient.
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function removeSpamModeJoinTime(userId) {
  const keys = [
    `spam_mode_join_time:${userId}`,
    `spam_mode_join:${userId}`,
    `spam_mode:join_time:${userId}`
  ];
  try {
    await Promise.all(keys.map((k) => keyv.delete(k)));
  } catch (error) {
    logger.error('Error removing spam-mode join-time tracking.', { err: error, userId });
  }
}

/**
 * Returns whether the user has left the guild before (returning member).
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function isFormerMember(userId) {
  try {
    const value = await keyv.get(`${FORMER_MEMBER_KEY_PREFIX}${userId}`);
    return value !== undefined && value !== null;
  } catch (err) {
    logger.error('Error checking former member.', { err: err, userId });
    return false;
  }
}

// ── Inactivity Tracking ──────────────────────────────────────────────────────

const userActivityCache = new Map(); // Debounce cache: { userId: timestamp }

/**
 * Updates the user's last message timestamp.
 * Uses an in-memory 5-minute debounce to avoid spamming the database.
 * @param {string} userId - The Discord user ID
 * @returns {Promise<void>}
 */
async function updateLastMessageTime(userId, channelId) {
  try {
    const now = Date.now();
    const lastUpdate = userActivityCache.get(userId) || 0;
    
    // Only write to SQLite at most once every 5 minutes per user
    if (now - lastUpdate > 300000) {
      await keyv.set(`last_message:${userId}`, now);
      if (channelId != null && String(channelId).trim() !== '') {
        await keyv.set(`last_message_channel:${userId}`, String(channelId));
      }
      userActivityCache.set(userId, now);
    }
  } catch (err) {
    logger.error('Error updating last message time.', { err, userId });
  }
}

/**
 * Gets a user's last message timestamp from the database.
 * @param {string} userId - The Discord user ID
 * @returns {Promise<number|null>} The timestamp or null if unrecorded
 */
async function getLastMessageTime(userId) {
  try {
    const ts = await keyv.get(`last_message:${userId}`);
    return ts || null;
  } catch (err) {
    logger.error('Error getting last message time.', { err, userId });
    return null;
  }
}

/**
 * Gets all stored last message timestamps using direct SQLite connection.
 * @returns {Promise<Object>} Map of { userId: timestamp }
 */
async function getAllLastMessageTimes() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(sqlitePath, { readonly: true });
    
    const rows = db.prepare(`
      SELECT key, value 
      FROM keyv 
      WHERE key LIKE 'main:last_message:%'
    `).all();
    
    db.close();
    
    const activityMap = {};
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        const timestamp = parsed?.value || parsed;
        const userId = row.key.replace('main:last_message:', '');
        if (userId && timestamp) {
          activityMap[userId] = timestamp;
        }
      } catch (e) {}
    }
    return activityMap;
  } catch (err) {
    logger.error('Error bulk fetching last message times.', { err });
    return {};
  }
}

/**
 * Bulk fetch message counts from keyv (same store as incrementMessageCount).
 * @returns {Promise<Record<string, number>>}
 */
async function getAllMessageCounts() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(sqlitePath, { readonly: true });

    const rows = db
      .prepare(
        `
      SELECT key, value 
      FROM keyv 
      WHERE key LIKE 'main:message_count:%'
    `
      )
      .all();

    db.close();

    const out = {};
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        const n = typeof parsed === 'number' ? parsed : parsed?.value ?? parsed;
        const userId = row.key.replace('main:message_count:', '');
        if (userId) out[userId] = Number(n) || 0;
      } catch (e) {}
    }
    return out;
  } catch (err) {
    logger.error('Error bulk fetching message counts.', { err });
    return {};
  }
}

/**
 * Bulk fetch last message channel ids (see updateLastMessageTime).
 * @returns {Promise<Record<string, string>>}
 */
async function getAllLastMessageChannels() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(sqlitePath, { readonly: true });

    const rows = db
      .prepare(
        `
      SELECT key, value 
      FROM keyv 
      WHERE key LIKE 'main:last_message_channel:%'
    `
      )
      .all();

    db.close();

    const out = {};
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        const raw = parsed?.value !== undefined ? parsed.value : parsed;
        const userId = row.key.replace('main:last_message_channel:', '');
        if (userId && raw != null && String(raw).trim() !== '') out[userId] = String(raw).trim();
      } catch (e) {}
    }
    return out;
  } catch (err) {
    logger.error('Error bulk fetching last message channels.', { err });
    return {};
  }
}

module.exports = {
  initializeDatabase,
  invalidateConfigCache,
  invalidateConfigCacheKey,
  getValue,
  setValue,
  deleteValue,
  cleanupOldTrackingUsers,
  setInviteTag,
  getInviteTag,
  deleteInviteTag,
  setInviteNotificationChannel,
  getInviteNotificationChannel,
  setInviteUsage,
  getInviteUsage,
  setInviteCodeToTagMap,
  getInviteCodeToTagMap,
  rebuildCodeToTagMap,
  getAllInviteTagsData,
  getGuildName,
  setFormerMember,
  isFormerMember,
  incrementMessageCount,
  getMessageCount,
  deleteMessageCount,
  removeMuteModeUser,
  removeSpamModeJoinTime,
  updateLastMessageTime,
  getLastMessageTime,
  getAllLastMessageTimes,
  getAllMessageCounts,
  getAllLastMessageChannels
};
