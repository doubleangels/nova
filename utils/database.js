const Keyv = require('keyv');
const { KeyvFile } = require('keyv-file');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Initialize Keyv with file storage
// Data will be stored in ./data/database.json
const keyv = new Keyv({
  store: new KeyvFile({
    filename: './data/database.json'
  }),
  namespace: 'nova'
});

// Handle connection errors
keyv.on('error', err => logger.error('Keyv connection error:', { error: err }));

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
      logger.info(`Testing database connection... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      const testKey = 'db_test_key';
      const testValue = 'test_value';
      
      await keyv.set(testKey, testValue);
      const retrieved = await keyv.get(testKey);
      
      if (retrieved === testValue) {
        logger.info("Database connection test successful.");
        await keyv.delete(testKey);
        logger.debug("Cleaned up database test data.");
        return;
      } else {
        throw new Error("Database read/write test failed.");
      }
      
    } catch (err) {
      lastError = err;
      logger.error(`Error testing database connection (Attempt ${retryCount + 1}/${MAX_RETRIES}):`, { error: err });
      
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      retryCount++;
      
      if (retryCount < MAX_RETRIES) {
        logger.info(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error("All database connection attempts failed. Stopping bot as database connectivity is critical.");
  
  if (lastError) {
    logger.error("Final database error:", { error: lastError });
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
    logger.debug(`Getting config value for key "${key}".`);
    const value = await keyv.get(`config:${key}`);
    return value !== undefined ? value : null;
  } catch (err) {
    logger.error(`Error getting key "${key}":`, { error: err });
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
    logger.debug(`Setting config value for key "${key}".`);
    await keyv.set(`config:${key}`, value);
    logger.debug(`Set config for key "${key}" successfully.`);
  } catch (err) {
    logger.error(`Error setting key "${key}":`, { error: err });
  }
}

/**
 * Deletes a configuration value from the database
 * @param {string} key - The configuration key to delete
 * @returns {Promise<void>}
 */
async function deleteValue(key) {
  try {
    logger.debug(`Deleting config for key "${key}".`);
    await keyv.delete(`config:${key}`);
    logger.debug(`Deleted config for key "${key}".`);
  } catch (err) {
    logger.error(`Error deleting key "${key}":`, { error: err });
  }
}

/**
 * Retrieves all configuration records from the database
 * @returns {Promise<Array>} Array of configuration records
 */
async function getAllConfigs() {
  try {
    logger.debug("Retrieving all config records.");
    // Keyv doesn't have a native "get all" method, so we'll need to track keys
    // For now, return empty array as this function may not be used
    // If needed, we can maintain a list of config keys separately
    logger.debug("Retrieved config records (not fully supported with Keyv).");
    return [];
  } catch (err) {
    logger.error("Error getting all config values:", { error: err });
    return [];
  }
}

/**
 * Executes a database query with timeout and error handling
 * Note: This function is kept for compatibility but Keyv doesn't support SQL queries
 * @param {string} text - The SQL query text (not used with Keyv)
 * @param {Array} [params=[]] - Query parameters (not used with Keyv)
 * @param {Object} [options={}] - Query options
 * @param {number} [options.timeout=30000] - Query timeout in milliseconds
 * @throws {Error} If query fails or times out
 * @returns {Promise<Object>} A mock query result object for compatibility
 */
async function query(text, params = [], options = {}) {
  logger.warn("query() function called but Keyv doesn't support SQL queries. This is likely a compatibility issue.");
  throw new Error("SQL queries are not supported with Keyv. Use the specific database functions instead.");
}

/**
 * Helper function to maintain a list of user IDs for a given type
 * @param {string} listKey - The key for the list (e.g., 'mute_mode_users')
 * @param {string} userId - The user ID to add
 * @returns {Promise<void>}
 */
async function addToUserList(listKey, userId) {
  try {
    const list = await keyv.get(listKey) || [];
    if (!list.includes(userId)) {
      list.push(userId);
      await keyv.set(listKey, list);
    }
  } catch (error) {
    logger.error(`Error adding to user list ${listKey}:`, { error: error.message });
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
    const list = await keyv.get(listKey) || [];
    const filtered = list.filter(id => id !== userId);
    await keyv.set(listKey, filtered);
  } catch (error) {
    logger.error(`Error removing from user list ${listKey}:`, { error: error.message });
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
    logger.debug(`Added mute mode user ${userId} with join time ${userData.joinTime}`);
  } catch (error) {
    logger.error(`Error adding mute mode user ${userId}:`, { error: error.message });
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
      logger.debug(`Removed user ${userId} from mute mode tracking.`);
    }
  } catch (error) {
    logger.error(`Error removing mute mode user ${userId}:`, { error: error.message });
  }
}

/**
 * Retrieves all users in mute mode tracking
 * @returns {Promise<Array>} Array of mute mode user records
 */
async function getAllMuteModeUsers() {
  try {
    const userIds = await keyv.get('mute_mode_users') || [];
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
    logger.error("Error getting all mute mode users:", { error: error.message });
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
    logger.error(`Error getting user join time for ${userId}:`, { error: error.message });
    return null;
  }
}

/**
 * Updates a user's join time in mute mode tracking (useful for testing)
 * @param {string} userId - The Discord user ID
 * @param {string} username - The Discord username
 * @param {Date|string|null} joinTime - The join time to set (null = set to NOW())
 * @returns {Promise<void>}
 */
async function updateUserJoinTime(userId, username, joinTime = null) {
  try {
    const timeToSet = joinTime 
      ? (joinTime instanceof Date ? joinTime.toISOString() : new Date(joinTime).toISOString())
      : new Date().toISOString();
    
    const userData = {
      userId,
      username,
      joinTime: timeToSet
    };
    
    await keyv.set(`mute_mode:${userId}`, userData);
    await addToUserList('mute_mode_users', userId);
    logger.debug(`Updated join time for user ${userId} to ${timeToSet}`);
  } catch (error) {
    logger.error(`Error updating user join time for ${userId}:`, { error: error.message });
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
    logger.debug(`Added spam mode join time for user ${userId} to ${timeToSet}`);
  } catch (error) {
    logger.error(`Error adding spam mode join time for user ${userId}:`, { error: error.message });
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
    logger.error(`Error getting spam mode join time for user ${userId}:`, { error: error.message });
    return null;
  }
}

/**
 * Updates a user's join time in spam mode tracking (useful for testing)
 * @param {string} userId - The Discord user ID
 * @param {string} username - The Discord username
 * @param {Date|string|null} joinTime - The join time to set (null = set to NOW())
 * @returns {Promise<void>}
 */
async function updateSpamModeJoinTime(userId, username, joinTime = null) {
  try {
    const timeToSet = joinTime 
      ? (joinTime instanceof Date ? joinTime.toISOString() : new Date(joinTime).toISOString())
      : new Date().toISOString();
    
    const userData = {
      userId,
      username,
      joinTime: timeToSet
    };
    
    await keyv.set(`spam_mode:${userId}`, userData);
    await addToUserList('spam_mode_users', userId);
    logger.debug(`Updated spam mode join time for user ${userId} to ${timeToSet}`);
  } catch (error) {
    logger.error(`Error updating spam mode join time for user ${userId}:`, { error: error.message });
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
      logger.debug(`Removed user ${userId} from spam mode tracking.`);
    }
  } catch (error) {
    logger.error(`Error removing spam mode join time for user ${userId}:`, { error: error.message });
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
    const spamUserIds = await keyv.get('spam_mode_users') || [];
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
    await keyv.set('spam_mode_users', remainingSpamUsers);
    
    // Clean up mute mode users
    const muteUserIds = await keyv.get('mute_mode_users') || [];
    const remainingMuteUsers = [];
    
    for (const userId of muteUserIds) {
      const userData = await keyv.get(`mute_mode:${userId}`);
      if (userData && userData.joinTime) {
        const joinTime = new Date(userData.joinTime);
        let shouldRemove = joinTime < muteCutoffTime;
        
        // If client is provided, also check if user is still in guild
        if (!shouldRemove && client) {
          let userInGuild = false;
          for (const guild of client.guilds.cache.values()) {
            try {
              const member = await guild.members.fetch(userId).catch(() => null);
              if (member) {
                userInGuild = true;
                break;
              }
            } catch (error) {
              // If fetch fails, assume user is not in guild
            }
          }
          if (!userInGuild) {
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
    await keyv.set('mute_mode_users', remainingMuteUsers);
    
    if (spamModeRemoved > 0 || muteModeRemoved > 0) {
      logger.info(`Cleaned up old tracking users: ${spamModeRemoved} users were removed from spam mode and ${muteModeRemoved} users were removed from mute mode.`);
    } else {
      logger.debug(`Cleanup completed: no old users found to remove`);
    }
    
    return { spamModeRemoved, muteModeRemoved };
  } catch (error) {
    logger.error('Error cleaning up old tracking users:', { error: error.message });
    throw error;
  }
}

module.exports = {
  initializeDatabase,
  getValue,
  setValue,
  deleteValue,
  getAllConfigs,
  query,
  addMuteModeUser,
  removeMuteModeUser,
  getAllMuteModeUsers,
  getUserJoinTime,
  updateUserJoinTime,
  addSpamModeJoinTime,
  getSpamModeJoinTime,
  updateSpamModeJoinTime,
  removeSpamModeJoinTime,
  cleanupOldTrackingUsers
};
