const requireDefault = (m) => (require(m).default || require(m));
const Keyv = requireDefault('keyv');
const KeyvSqlite = requireDefault('@keyv/sqlite');
const path = require('path');
const fs = require('fs');
const logger = require('../logger')(path.basename(__filename));

// Ensure data directory exists with proper permissions
const dataDir = path.resolve(process.cwd(), 'data');
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
          
          // Try to query the database directly to see what's in it
          try {
            const Database = require('better-sqlite3');
            const db = new Database(sqlitePath, { readonly: true });
            const rows = db.prepare('SELECT COUNT(*) as count FROM keyv').get();
            logger.info('Database contains keys in keyv table.', {
              keyCount: rows.count
            });
            db.close();
          } catch (dbError) {
            logger.debug('Could not query database directly, this is OK.', {
              err: dbError
            });
          }
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

/**
 * Retrieves a configuration value from the database
 * @param {string} key - The configuration key to retrieve
 * @returns {Promise<any>} The configuration value, or null if not found
 */
async function getValue(key) {
  try {
    logger.debug('Getting config value for key.', {
      key: key
    });
    const value = await keyv.get(`config:${key}`);
    return value !== undefined ? value : null;
  } catch (err) {
    logger.error('Error occurred while getting key.', {
      err: err,
      key: key
    });
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
    logger.debug('Setting config value for key.', {
      key: key
    });
    await keyv.set(`config:${key}`, value);
    logger.debug('Set config for key successfully.', {
      key: key
    });
  } catch (err) {
    logger.error('Error occurred while setting key.', {
      err: err,
      key: key
    });
  }
}

/**
 * Deletes a configuration value from the database
 * @param {string} key - The configuration key to delete
 * @returns {Promise<void>}
 */
async function deleteValue(key) {
  try {
    logger.debug('Deleting config for key.', {
      key: key
    });
    await keyv.delete(`config:${key}`);
    logger.debug('Deleted config for key successfully.', {
      key: key
    });
  } catch (err) {
    logger.error('Error occurred while deleting key.', {
      err: err,
      key: key
    });
  }
}

/**
 * Helper function to maintain a list of user IDs for a given type
 * @param {string} listKey - The key for the list (e.g., 'mute_mode_users')
 * @param {string} userId - The user ID to add
 * @returns {Promise<void>}
 */
async function addToUserList(listKey, userId) {
  try {
    const configKey = `config:${listKey}`;
    const list = await keyv.get(configKey) || [];
    if (!list.includes(userId)) {
      list.push(userId);
      await keyv.set(configKey, list);
    }
  } catch (error) {
    logger.error('Error occurred while adding to user list.', {
      err: error,
      listKey: listKey
    });
  }
}

/**
 * Helper function to remove a user ID from a list
 * @param {string} listKey - The key for the list (e.g., 'mute_mode_users')
 * @param {string} userId - The user ID to remove
 * @returns {Promise<void>}
 */
async function removeFromUserList(listKey, userId) {
  try {
    const configKey = `config:${listKey}`;
    const list = await keyv.get(configKey) || [];
    const filtered = list.filter(id => id !== userId);
    await keyv.set(configKey, filtered);
  } catch (error) {
    logger.error('Error occurred while removing from user list.', {
      err: error,
      listKey: listKey
    });
  }
}

/**
 * Adds a user to mute mode tracking
 * @param {string} userId - The Discord user ID
 * @param {string} username - The Discord username
 * @returns {Promise<void>}
 */
async function addMuteModeUser(userId, username) {
  try {
    const userData = {
      userId,
      username,
      joinTime: new Date().toISOString()
    };
    await keyv.set(`mute_mode:${userId}`, userData);
    await addToUserList('mute_mode_users', userId);
    logger.debug('Added mute mode user with join time.', {
      userId: userId,
      joinTime: userData.joinTime
    });
  } catch (error) {
    logger.error('Error occurred while adding mute mode user.', {
      err: error,
      userId: userId
    });
  }
}

/**
 * Removes a user from mute mode tracking
 * Removes immediately when called (e.g., when user sends a message)
 * @param {string} userId - The Discord user ID
 * @returns {Promise<void>}
 */
async function removeMuteModeUser(userId) {
  try {
    const deleted = await keyv.delete(`mute_mode:${userId}`);
    await removeFromUserList('mute_mode_users', userId);
    if (deleted) {
      logger.debug('Removed user from mute mode tracking.', {
        userId: userId
      });
    }
  } catch (error) {
    logger.error('Error occurred while removing mute mode user.', {
      err: error,
      userId: userId
    });
  }
}

/**
 * Retrieves all users in mute mode tracking
 * @returns {Promise<Array>} Array of mute mode user records
 */
async function getAllMuteModeUsers() {
  try {
    const userIds = await keyv.get('config:mute_mode_users') || [];
    const users = [];
    
    for (const userId of userIds) {
      const userData = await keyv.get(`mute_mode:${userId}`);
      if (userData) {
        users.push({
          user_id: userData.userId,
          username: userData.username,
          join_time: userData.joinTime
        });
      }
    }
    
    return users;
  } catch (error) {
    logger.error("Error occurred while getting all mute mode users.", {
      err: error
    });
    return [];
  }
}

/**
 * Gets the join time for a user from mute mode tracking
 * @param {string} userId - The Discord user ID
 * @returns {Promise<Date|null>} The join time or null if user not found
 */
async function getUserJoinTime(userId) {
  try {
    const userData = await keyv.get(`mute_mode:${userId}`);
    if (userData && userData.joinTime) {
      return new Date(userData.joinTime);
    }
    return null;
  } catch (error) {
    logger.error('Error occurred while getting user join time.', {
      err: error,
      userId: userId
    });
    return null;
  }
}

/**
 * Adds a user's join time to spam mode tracking
 * @param {string} userId - The Discord user ID
 * @param {string} username - The Discord username
 * @param {Date|string} joinTime - The join time
 * @returns {Promise<void>}
 */
async function addSpamModeJoinTime(userId, username, joinTime) {
  try {
    const timeToSet = joinTime instanceof Date ? joinTime.toISOString() : new Date(joinTime).toISOString();
    
    const userData = {
      userId,
      username,
      joinTime: timeToSet
    };
    
    await keyv.set(`spam_mode:${userId}`, userData);
    await addToUserList('spam_mode_users', userId);
    logger.debug('Added spam mode join time for user.', {
      userId: userId,
      joinTime: timeToSet
    });
  } catch (error) {
    logger.error('Error occurred while adding spam mode join time for user.', {
      err: error,
      userId: userId
    });
  }
}

/**
 * Gets the join time for a user from spam mode tracking
 * @param {string} userId - The Discord user ID
 * @returns {Promise<Date|null>} The join time or null if user not found
 */
async function getSpamModeJoinTime(userId) {
  try {
    const userData = await keyv.get(`spam_mode:${userId}`);
    if (userData && userData.joinTime) {
      return new Date(userData.joinTime);
    }
    return null;
  } catch (error) {
    logger.error('Error occurred while getting spam mode join time for user.', {
      err: error,
      userId: userId
    });
    return null;
  }
}

/**
 * Removes a user from spam mode tracking (after they're past the window)
 * @param {string} userId - The Discord user ID
 * @returns {Promise<void>}
 */
async function removeSpamModeJoinTime(userId) {
  try {
    const deleted = await keyv.delete(`spam_mode:${userId}`);
    await removeFromUserList('spam_mode_users', userId);
    if (deleted) {
      logger.debug('Removed user from spam mode tracking.', {
        userId: userId
      });
    }
  } catch (error) {
    logger.error('Error occurred while removing spam mode join time for user.', {
      err: error,
      userId: userId
    });
  }
}

/**
 * Cleans up old users from tracking tables who are past their tracking windows
 * Removes users from spam_mode_join_times and mute_mode_recovery who are older than their respective windows
 * @param {Client} client - The Discord client instance (optional, for checking if users are still in guild)
 * @returns {Promise<{spamModeRemoved: number, muteModeRemoved: number}>} Number of users removed from each table
 */
async function cleanupOldTrackingUsers(client = null) {
  try {
    // Get window settings
    let spamWindowHours = parseInt(await getValue('spam_mode_window_hours'), 10);
    if (!spamWindowHours) {
      spamWindowHours = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
    }
    
    let muteWindowHours = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
    
    const spamWindowMs = spamWindowHours * 60 * 60 * 1000;
    const muteWindowMs = muteWindowHours * 60 * 60 * 1000;
    const now = Date.now();
    const spamCutoffTime = new Date(now - spamWindowMs);
    const muteCutoffTime = new Date(now - muteWindowMs);
    
    let spamModeRemoved = 0;
    let muteModeRemoved = 0;
    
    // Clean up spam mode users
    const spamUserIds = await keyv.get('config:spam_mode_users') || [];
    const remainingSpamUsers = [];
    
    for (const userId of spamUserIds) {
      const userData = await keyv.get(`spam_mode:${userId}`);
      if (userData && userData.joinTime) {
        const joinTime = new Date(userData.joinTime);
        if (joinTime < spamCutoffTime) {
          await keyv.delete(`spam_mode:${userId}`);
          spamModeRemoved++;
        } else {
          remainingSpamUsers.push(userId);
        }
      } else {
        // User data missing, remove from list
        spamModeRemoved++;
      }
    }
    await keyv.set('config:spam_mode_users', remainingSpamUsers);
    
    // Clean up mute mode users
    const muteUserIds = await keyv.get('config:mute_mode_users') || [];
    const remainingMuteUsers = [];
    
    for (const userId of muteUserIds) {
      const userData = await keyv.get(`mute_mode:${userId}`);
      if (userData && userData.joinTime) {
        const joinTime = new Date(userData.joinTime);
        let shouldRemove = joinTime < muteCutoffTime;
        
        // If client is provided, also check if user is still in guild
        // Bot is only in one guild, so check that guild directly
        if (!shouldRemove && client) {
          const guild = client.guilds.cache.first();
          if (guild) {
            try {
              const member = await guild.members.fetch(userId).catch(() => null);
              if (!member) {
                shouldRemove = true;
              }
            } catch (error) {
              // If fetch fails, assume user is not in guild
              shouldRemove = true;
            }
          } else {
            // No guild found, remove user
            shouldRemove = true;
          }
        }
        
        if (shouldRemove) {
          await keyv.delete(`mute_mode:${userId}`);
          muteModeRemoved++;
        } else {
          remainingMuteUsers.push(userId);
        }
      } else {
        // User data missing, remove from list
        muteModeRemoved++;
      }
    }
    await keyv.set('config:mute_mode_users', remainingMuteUsers);
    
    if (spamModeRemoved > 0 || muteModeRemoved > 0) {
      logger.info('Cleaned up old tracking users.', {
        spamModeRemoved: spamModeRemoved,
        muteModeRemoved: muteModeRemoved
      });
    } else {
      logger.debug('Cleanup completed, no old users found to remove.');
    }
    
    return { spamModeRemoved, muteModeRemoved };
  } catch (error) {
    logger.error('Error occurred while cleaning up old tracking users.', {
      err: error
    });
    throw error;
  }
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
async function getAllInviteTagsData() {
  try {
    logger.debug("Getting all invite tags.");
    const Database = require('better-sqlite3');
    const db = new Database(sqlitePath, { readonly: true });
    
    // Query all keys from invites namespace that start with tags:
    const rows = db.prepare(`
      SELECT key, value 
      FROM keyv 
      WHERE key LIKE 'invites:tags:%'
    `).all();
    
    db.close();
    
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
    const Database = require('better-sqlite3');
    const db = new Database(sqlitePath, { readonly: true });
    
    // Query all keys from invites namespace that start with tags:
    const rows = db.prepare(`
      SELECT key, value 
      FROM keyv 
      WHERE key LIKE 'invites:tags:%'
    `).all();
    
    db.close();
    
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
  const config = require('../config');
  return config.guildName || 'Da Frens';
}

module.exports = {
  initializeDatabase,
  getValue,
  setValue,
  deleteValue,
  addMuteModeUser,
  removeMuteModeUser,
  getAllMuteModeUsers,
  getUserJoinTime,
  addSpamModeJoinTime,
  getSpamModeJoinTime,
  removeSpamModeJoinTime,
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
  getGuildName
};
