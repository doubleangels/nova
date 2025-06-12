/**
 * Database utility module for managing PostgreSQL database operations.
 * Handles connection pooling, query execution, and data management.
 * @module utils/database
 */

const { Pool } = require('pg');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const config = require('../config');

// Database Tables
const DB_TABLES = {
  CONFIG: 'main.config',
  REMINDERS: 'main.reminder_data',
  TRACKED_MEMBERS: 'main.tracked_members',
  TIMEZONES: 'main.timezones',
  MUTE_MODE: 'main.mute_mode',
  MUTE_MODE_RECOVERY: 'main.mute_mode_recovery'
};

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: {
    rejectUnauthorized: true 
  },
  query_timeout: 30000
});

pool.on('error', (err, client) => {
  logger.error('Unexpected error on idle client', { error: err });
});

/**
 * Initializes the database connection and performs a test query.
 * @async
 * @function initializeDatabase
 * @throws {Error} If database connection fails after retries
 */
async function initializeDatabase() {
  const MAX_RETRIES = 3;
  const INITIAL_RETRY_DELAY = 1000;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
    const client = await pool.connect();
    try {
      logger.info(`Testing database connection... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      const testKey = 'db_test_key';
      const testValue = 'test_value';
      
      await client.query(
        `INSERT INTO ${DB_TABLES.CONFIG} (id, value) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET value = $2`,
        [testKey, JSON.stringify(testValue)]
      );
      
      const result = await client.query(
        `SELECT value FROM ${DB_TABLES.CONFIG} WHERE id = $1`,
        [testKey]
      );
      
      if (result.rows.length > 0 && JSON.parse(result.rows[0].value) === testValue) {
        logger.info("Database connection test successful.");
      } else {
        throw new Error("Database read/write test failed.");
      }

      await client.query(
        `DELETE FROM ${DB_TABLES.CONFIG} WHERE id = $1`,
        [testKey]
      );
      logger.debug("Cleaned up database test data.");
      
      return;
      
    } catch (err) {
      lastError = err;
      logger.error(`Error testing database connection (Attempt ${retryCount + 1}/${MAX_RETRIES}):`, { error: err });
      
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      retryCount++;
      
      if (retryCount < MAX_RETRIES) {
        logger.info(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } finally {
      client.release();
    }
  }

  logger.error("All database connection attempts failed. Stopping bot as database connectivity is critical.");
  
  if (lastError) {
    logger.error("Final database error:", { error: lastError });
  }
  
  process.exit(1);
}

/**
 * Retrieves a configuration value from the database.
 * @async
 * @function getValue
 * @param {string} key - The configuration key to retrieve
 * @returns {Promise<any>} The configuration value, or null if not found
 */
async function getValue(key) {
  const client = await pool.connect();
  try {
    logger.debug(`Getting config value for key "${key}".`);
    const result = await client.query(
      `SELECT value FROM ${DB_TABLES.CONFIG} WHERE id = $1`,
      [key]
    );
    const parsed = result.rows.length > 0 && result.rows[0].value 
      ? JSON.parse(result.rows[0].value) 
      : null;
    logger.debug(`Retrieved config for key "${key}": ${parsed}`);
    return parsed;
  } catch (err) {
    logger.error(`Error getting key "${key}":`, { error: err });
    return null;
  } finally {
    client.release();
  }
}

/**
 * Sets a configuration value in the database.
 * @async
 * @function setValue
 * @param {string} key - The configuration key to set
 * @param {any} value - The value to store
 */
async function setValue(key, value) {
  const client = await pool.connect();
  try {
    logger.debug(`Setting config value for key "${key}".`);
    const serialized = JSON.stringify(value);
    
    await client.query(
      `INSERT INTO ${DB_TABLES.CONFIG} (id, value) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET value = $2`,
      [key, serialized]
    );
    
    logger.debug(`Set config for key "${key}" successfully.`);
  } catch (err) {
    logger.error(`Error setting key "${key}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Deletes a configuration value from the database.
 * @async
 * @function deleteValue
 * @param {string} key - The configuration key to delete
 */
async function deleteValue(key) {
  const client = await pool.connect();
  try {
    logger.debug(`Deleting config for key "${key}".`);
    await client.query(`DELETE FROM ${DB_TABLES.CONFIG} WHERE id = $1`, [key]);
    logger.debug(`Deleted config for key "${key}".`);
  } catch (err) {
    logger.error(`Error deleting key "${key}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Retrieves all configuration values from the database.
 * @async
 * @function getAllConfigs
 * @returns {Promise<Array>} Array of configuration records
 */
async function getAllConfigs() {
  const client = await pool.connect();
  try {
    logger.debug("Retrieving all config records.");
    const result = await client.query(`SELECT * FROM ${DB_TABLES.CONFIG}`);
    logger.debug(`Retrieved ${result.rows.length} config records.`);
    return result.rows;
  } catch (err) {
    logger.error("Error getting all config values:", { error: err });
    return [];
  } finally {
    client.release();
  }
}

/**
 * Tracks a new member in the database.
 * @async
 * @function trackNewMember
 * @param {string} memberId - The member's Discord ID
 * @param {string} username - The member's username
 * @param {string} joinTime - The member's join time in ISO format
 */
async function trackNewMember(memberId, username, joinTime) {
  const client = await pool.connect();
  try {
    const formattedJoinTime = dayjs(joinTime).toISOString();
    logger.debug(`Tracking new member "${username}" (ID: ${memberId}) joining at ${formattedJoinTime}.`);
    
    await client.query(
      `INSERT INTO ${DB_TABLES.CONFIG} (id, value) 
       VALUES ($1, $2) 
       ON CONFLICT (id) 
       DO UPDATE SET value = $2`,
      [`mute_join_${memberId}`, JSON.stringify(formattedJoinTime)]
    );
    
    logger.info(`Successfully tracked member "${username}" (ID: ${memberId}).`);
  } catch (err) {
    logger.error(`Error tracking new member "${username}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Retrieves tracking data for a member.
 * @async
 * @function getTrackedMember
 * @param {string} memberId - The member's Discord ID
 * @returns {Promise<Object|null>} The member's tracking data, or null if not found
 */
async function getTrackedMember(memberId) {
  const client = await pool.connect();
  try {
    logger.debug(`Retrieving tracking data for member ID "${memberId}".`);
    
    const joinTimeResult = await client.query(
      `SELECT value FROM ${DB_TABLES.CONFIG} WHERE id = $1`,
      [`mute_join_${memberId}`]
    );

    if (joinTimeResult.rows.length > 0) {
      const data = {
        member_id: memberId,
        username: joinTimeResult.rows[0].value
      };
      logger.debug(`Found tracking data for member ID "${memberId}": ${JSON.stringify(data)}`);
      return data;
    }
    
    logger.debug(`No tracking data found for member ID "${memberId}".`);
    return null;
  } catch (err) {
    logger.error(`Error retrieving tracking data for member ID "${memberId}":`, { error: err });
    return null;
  } finally {
    client.release();
  }
}

/**
 * Removes tracking data for a member.
 * @async
 * @function removeTrackedMember
 * @param {string} memberId - The member's Discord ID
 * @returns {Promise<boolean>} Whether the member was successfully removed from tracking
 */
async function removeTrackedMember(memberId) {
  const client = await pool.connect();
  try {
    logger.debug(`Removing tracking data for member ID "${memberId}".`);
    
    const result = await client.query(
      `DELETE FROM ${DB_TABLES.CONFIG} WHERE id = $1 RETURNING *`,
      [`mute_join_${memberId}`]
    );
    
    if (result.rowCount === 0) {
      logger.debug(`No tracking data found for member ID "${memberId}" to remove.`);
      return false;
    } else {
      logger.info(`Successfully removed tracking data for member ID "${memberId}".`);
      return true;
    }
  } catch (err) {
    logger.error("Error removing tracked member:", { error: err });
    return false;
  } finally {
    client.release();
  }
}

/**
 * Retrieves all tracked members from the database.
 * @async
 * @function getAllTrackedMembers
 * @returns {Promise<Array>} Array of tracked member records
 */
async function getAllTrackedMembers() {
  const client = await pool.connect();
  try {
    logger.debug("Retrieving all tracked members.");
    
    const joinTimesResult = await client.query(
      `SELECT id, value FROM ${DB_TABLES.CONFIG} WHERE id LIKE 'mute_join_%'`
    );

    const trackedMembers = joinTimesResult.rows.map(row => {
      const memberId = row.id.replace('mute_join_', '');
      return {
        member_id: memberId,
        username: row.value
      };
    });

    logger.info(`Retrieved ${trackedMembers.length} tracked member(s).`);
    return trackedMembers;
  } catch (err) {
    logger.error("Error retrieving all tracked members:", { error: err });
    return [];
  } finally {
    client.release();
  }
}

/**
 * Sets a user's timezone in the database.
 * @async
 * @function setUserTimezone
 * @param {string} memberId - The member's Discord ID
 * @param {string} timezone - The timezone to set
 * @throws {Error} If timezone or memberId is invalid
 */
async function setUserTimezone(memberId, timezone) {
  const client = await pool.connect();
  try {
    if (typeof timezone !== 'string' || timezone.trim() === '') {
        throw new Error(`Invalid timezone provided: ${timezone}`);
    }
    if (typeof memberId !== 'string' || memberId.trim() === '' || !/^\d+$/.test(memberId)) {
        throw new Error(`Invalid memberId provided (must be a string representing an integer): ${memberId}`);
    }

    logger.debug(`Setting timezone for member ID "${memberId}" to "${timezone}".`);

    const query = `
      INSERT INTO ${DB_TABLES.TIMEZONES} (member_id, timezone)
      VALUES ($1::bigint, $2)
      ON CONFLICT (member_id)
      DO UPDATE SET timezone = $2;
    `;
    await client.query(query, [memberId, timezone.trim()]);

    logger.info(`Successfully set timezone for member ID "${memberId}".`);
  } catch (err) {
    logger.error(`Error setting timezone for member ID "${memberId}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Retrieves a user's timezone from the database.
 * @async
 * @function getUserTimezone
 * @param {string} memberId - The member's Discord ID
 * @returns {Promise<string|null>} The member's timezone, or null if not found
 */
async function getUserTimezone(memberId) {
  const client = await pool.connect();
  try {
    if (typeof memberId !== 'string' || memberId.trim() === '' || !/^\d+$/.test(memberId)) {
        logger.warn(`Attempted to get timezone with invalid memberId format: ${memberId}`);
        return null;
    }

    logger.debug(`Getting timezone for member ID "${memberId}".`);

    const result = await client.query(
      `SELECT timezone FROM ${DB_TABLES.TIMEZONES} WHERE member_id = $1::bigint`,
      [memberId]
    );

    if (result.rows.length > 0) {
      const timezone = result.rows[0].timezone;
      logger.debug(`Found timezone for member ID "${memberId}": ${timezone}`);
      return timezone;
    } else {
      logger.debug(`No timezone found for member ID "${memberId}".`);
      return null;
    }
  } catch (err) {
    logger.error(`Error getting timezone for member ID "${memberId}":`, { error: err });
    return null;
  } finally {
    client.release();
  }
}

/**
 * Executes a database query with timeout handling.
 * @async
 * @function query
 * @param {string} text - The SQL query text
 * @param {Array} [params=[]] - Query parameters
 * @param {Object} [options={}] - Query options
 * @param {number} [options.timeout=30000] - Query timeout in milliseconds
 * @returns {Promise<Object>} Query result
 * @throws {Error} If query times out or encounters an error
 */
async function query(text, params = [], options = {}) {
  const client = await pool.connect();
  const timeout = options.timeout || 30000;
  
  try {
    await client.query(`SET statement_timeout = ${timeout}`);
    
    const result = await Promise.race([
      client.query(text, params),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), timeout)
      )
    ]);
    
    return result;
  } catch (error) {
    if (error.code === '40P01') {
      logger.error('Deadlock detected in database query:', { error });
      throw new Error('We encountered a deadlock while processing your request. Please try again.');
    }
    
    if (error.message === 'Query timeout') {
      logger.error('Query timeout:', { 
        query: text,
        params,
        timeout
      });
      throw new Error('We took too long to process your request. Please try again.');
    }
    
    logger.error('Database query error:', { error });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Add user to mute_mode table
 * @async
 * @function addMuteModeUser
 * @param {string} userId - The user's Discord ID
 * @param {string} username - The user's username
 */
async function addMuteModeUser(userId, username) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ${DB_TABLES.MUTE_MODE} (user_id, username, join_time)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET username = $2, join_time = NOW()`,
      [userId, username]
    );
  } finally {
    client.release();
  }
}

/**
 * Remove user from mute_mode table
 * @async
 * @function removeMuteModeUser
 * @param {string} userId - The user's Discord ID
 */
async function removeMuteModeUser(userId) {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM ${DB_TABLES.MUTE_MODE} WHERE user_id = $1`,
      [userId]
    );
  } finally {
    client.release();
  }
}

/**
 * Get all users in mute_mode table
 * @async
 * @function getAllMuteModeUsers
 * @returns {Promise<Array>} Array of mute_mode records
 */
async function getAllMuteModeUsers() {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM ${DB_TABLES.MUTE_MODE}`);
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * Sets a mute mode recovery timestamp for a user.
 * @async
 * @function setMuteModeRecoveryTime
 * @param {string} userId - The user's Discord ID
 * @param {Date|string} kickAt - The timestamp (Date or ISO string) when the user should be kicked
 */
async function setMuteModeRecoveryTime(userId, kickAt) {
  const client = await pool.connect();
  try {
    // Accept Date or ISO string
    const kickAtTimestamp = (kickAt instanceof Date) ? kickAt.toISOString() : new Date(kickAt).toISOString();
    logger.debug(`Setting mute mode recovery time for user ${userId} to ${kickAtTimestamp}.`);
    await client.query(
      `INSERT INTO ${DB_TABLES.MUTE_MODE_RECOVERY} (user_id, kick_at)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET kick_at = $2`,
      [userId, kickAtTimestamp]
    );
    logger.debug(`Set mute mode recovery time for user ${userId} successfully.`);
  } catch (err) {
    logger.error(`Error setting mute mode recovery time for user ${userId}:`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Gets a mute mode recovery timestamp for a user.
 * @async
 * @function getMuteModeRecoveryTime
 * @param {string} userId - The user's Discord ID
 * @returns {Promise<Date|null>} The kick_at timestamp as a Date object, or null if not found
 */
async function getMuteModeRecoveryTime(userId) {
  const client = await pool.connect();
  try {
    logger.debug(`Getting mute mode recovery time for user ${userId}`);
    const result = await client.query(
      `SELECT kick_at FROM ${DB_TABLES.MUTE_MODE_RECOVERY} WHERE user_id = $1`,
      [userId]
    );
    const kickAt = result.rows.length > 0 ? result.rows[0].kick_at : null;
    logger.debug(`Retrieved mute mode recovery time for user ${userId}: ${kickAt}`);
    return kickAt ? new Date(kickAt) : null;
  } catch (err) {
    logger.error(`Error getting mute mode recovery time for user ${userId}:`, { error: err });
    return null;
  } finally {
    client.release();
  }
}

/**
 * Deletes a mute mode recovery timestamp for a user.
 * @async
 * @function deleteMuteModeRecoveryTime
 * @param {string} userId - The user's Discord ID
 */
async function deleteMuteModeRecoveryTime(userId) {
  const client = await pool.connect();
  try {
    logger.debug(`Deleting mute mode recovery time for user ${userId}`);
    await client.query(
      `DELETE FROM ${DB_TABLES.MUTE_MODE_RECOVERY} WHERE user_id = $1`,
      [userId]
    );
    logger.debug(`Deleted mute mode recovery time for user ${userId}`);
  } catch (err) {
    logger.error(`Error deleting mute mode recovery time for user ${userId}:`, { error: err });
  } finally {
    client.release();
  }
}

module.exports = {
  initializeDatabase,
  getValue,
  setValue,
  deleteValue,
  getAllConfigs,
  trackNewMember,
  getTrackedMember,
  removeTrackedMember,
  getAllTrackedMembers,
  setUserTimezone,
  getUserTimezone,
  query,
  addMuteModeUser,
  removeMuteModeUser,
  getAllMuteModeUsers,
  setMuteModeRecoveryTime,
  getMuteModeRecoveryTime,
  deleteMuteModeRecoveryTime
};