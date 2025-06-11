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

const DB_SCHEMA = 'main';
const DB_DEFAULT_QUERY_TIMEOUT = 30000;
const DB_CONNECTION_OPTIONS = {
  connectionString: config.neonConnectionString,
  ssl: {
    rejectUnauthorized: true 
  },
  query_timeout: DB_DEFAULT_QUERY_TIMEOUT
};

// Database Tables
const DB_TABLES = {
  CONFIG: `${DB_SCHEMA}.config`,
  REMINDERS: `${DB_SCHEMA}.reminder_data`,
  TRACKED_MEMBERS: `${DB_SCHEMA}.tracked_members`,
  TIMEZONES: `${DB_SCHEMA}.timezones`,
  MESSAGE_COUNTS: `${DB_SCHEMA}.message_counts`,
  VOICE_TIME: `${DB_SCHEMA}.voice_time`,
  VOICE_CHANNEL_TIME: `${DB_SCHEMA}.voice_channel_time`,
  MESSAGE_CHANNEL_COUNTS: `${DB_SCHEMA}.message_channel_counts`
};

const pool = new Pool(DB_CONNECTION_OPTIONS);

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
      `INSERT INTO ${DB_TABLES.MESSAGE_COUNTS} (member_id, username, message_count, last_updated) 
       VALUES ($1, $2, 0, CURRENT_TIMESTAMP) 
       ON CONFLICT (member_id) 
       DO UPDATE SET username = $2`,
      [memberId, username]
    );

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

    const messageResult = await client.query(
      `SELECT * FROM ${DB_TABLES.MESSAGE_COUNTS} WHERE member_id = $1`,
      [memberId]
    );
    
    if (joinTimeResult.rows.length > 0 && messageResult.rows.length > 0) {
      const data = {
        member_id: memberId,
        username: messageResult.rows[0].username,
        join_time: JSON.parse(joinTimeResult.rows[0].value),
        message_count: messageResult.rows[0].message_count
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

    const messageResult = await client.query(
      `SELECT member_id, username, message_count FROM ${DB_TABLES.MESSAGE_COUNTS}`
    );

    const trackedMembers = joinTimesResult.rows.map(row => {
      const memberId = row.id.replace('mute_join_', '');
      const messageData = messageResult.rows.find(m => m.member_id === memberId);
      return {
        member_id: memberId,
        username: messageData?.username || 'Unknown',
        join_time: JSON.parse(row.value),
        message_count: messageData?.message_count || 0
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
 * Increments the message count for a member.
 * @async
 * @function incrementMessageCount
 * @param {string} memberId - The member's Discord ID
 * @param {string} username - The member's username
 */
async function incrementMessageCount(memberId, username) {
  const client = await pool.connect();
  try {
    logger.debug(`Incrementing message count for member "${username}" (ID: ${memberId}).`);
    
    await client.query(`
      INSERT INTO ${DB_TABLES.MESSAGE_COUNTS} (member_id, username, message_count)
      VALUES ($1, $2, 1)
      ON CONFLICT (member_id) 
      DO UPDATE SET 
        message_count = ${DB_TABLES.MESSAGE_COUNTS}.message_count + 1,
        username = $2,
        last_updated = CURRENT_TIMESTAMP;
    `, [memberId, username]);
    
    logger.debug(`Successfully incremented message count for member "${username}" (ID: ${memberId}).`);
  } catch (err) {
    logger.error(`Error incrementing message count for member "${username}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Retrieves the top message senders from the database.
 * @async
 * @function getTopMessageSenders
 * @param {number} [limit=10] - Maximum number of results to return
 * @returns {Promise<Array>} Array of top message sender records
 */
async function getTopMessageSenders(limit = 10) {
  const client = await pool.connect();
  try {
    logger.debug(`Retrieving top ${limit} message senders.`);
    
    const result = await client.query(`
      SELECT member_id, username, message_count
      FROM ${DB_TABLES.MESSAGE_COUNTS}
      ORDER BY message_count DESC
      LIMIT $1;
    `, [limit]);
    
    logger.debug(`Retrieved ${result.rows.length} top message senders.`);
    return result.rows;
  } catch (err) {
    logger.error("Error retrieving top message senders:", { error: err });
    return [];
  } finally {
    client.release();
  }
}

/**
 * Updates a user's voice time in the database.
 * @async
 * @function updateVoiceTime
 * @param {string} memberId - The member's Discord ID
 * @param {string} username - The member's username
 * @param {number} minutesSpent - Number of minutes spent in voice
 */
async function updateVoiceTime(memberId, username, minutesSpent) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ${DB_TABLES.VOICE_TIME} (member_id, username, minutes_spent, last_updated)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (member_id) DO UPDATE SET
         username = $2,
         minutes_spent = ${DB_TABLES.VOICE_TIME}.minutes_spent + $3,
         last_updated = CURRENT_TIMESTAMP`,
      [memberId, username, minutesSpent]
    );
  } finally {
    client.release();
  }
}

/**
 * Retrieves the top voice users from the database.
 * @async
 * @function getTopVoiceUsers
 * @param {number} [limit=10] - Maximum number of results to return
 * @returns {Promise<Array>} Array of top voice user records
 */
async function getTopVoiceUsers(limit = 10) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT member_id, username, seconds_spent, last_updated
       FROM ${DB_TABLES.VOICE_TIME}
       ORDER BY seconds_spent DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Retrieves a user's voice time from the database.
 * @async
 * @function getUserVoiceTime
 * @param {string} memberId - The member's Discord ID
 * @returns {Promise<Object|null>} The member's voice time record, or null if not found
 */
async function getUserVoiceTime(memberId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT member_id, username, seconds_spent, last_updated
       FROM ${DB_TABLES.VOICE_TIME}
       WHERE member_id = $1`,
      [memberId]
    );
    return result.rows[0] || null;
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
 * @param {number} [options.timeout=DB_DEFAULT_QUERY_TIMEOUT] - Query timeout in milliseconds
 * @returns {Promise<Object>} Query result
 * @throws {Error} If query times out or encounters an error
 */
async function query(text, params = [], options = {}) {
  const client = await pool.connect();
  const timeout = options.timeout || DB_DEFAULT_QUERY_TIMEOUT;
  
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
 * Adds a voice session to user statistics.
 * @async
 * @function addVoiceSessionToStats
 * @param {string} userId - The user's Discord ID
 * @param {string} username - The user's username
 * @param {number} durationSeconds - Duration of the voice session in seconds
 */
async function addVoiceSessionToStats(userId, username, durationSeconds) {
  const client = await pool.connect();
  try {
    if (durationSeconds > 0) {
      await client.query(
        `INSERT INTO main.voice_time (member_id, username, seconds_spent, last_updated)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (member_id) DO UPDATE SET
           username = $2,
           seconds_spent = main.voice_time.seconds_spent + $3,
           last_updated = NOW()`,
        [userId, username, durationSeconds]
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Adds a voice session to channel statistics.
 * @async
 * @function addVoiceSessionToChannelStats
 * @param {string} channelId - The channel's Discord ID
 * @param {string} channelName - The channel's name
 * @param {number} durationSeconds - Duration of the voice session in seconds
 */
async function addVoiceSessionToChannelStats(channelId, channelName, durationSeconds) {
  const client = await pool.connect();
  try {
    if (durationSeconds > 0) {
      await client.query(
        `INSERT INTO main.voice_channel_time (channel_id, channel_name, total_seconds, last_updated)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (channel_id) DO UPDATE SET
           channel_name = $2,
           total_seconds = main.voice_channel_time.total_seconds + $3,
           last_updated = NOW()`,
        [channelId, channelName, durationSeconds]
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Increments the message count for a channel.
 * @async
 * @function incrementChannelMessageCount
 * @param {string} channelId - The channel's Discord ID
 * @param {string} channelName - The channel's name
 */
async function incrementChannelMessageCount(channelId, channelName) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO main.message_channel_counts (channel_id, channel_name, message_count, last_updated)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (channel_id) DO UPDATE SET
         channel_name = $2,
         message_count = main.message_channel_counts.message_count + 1,
         last_updated = NOW()`,
      [channelId, channelName]
    );
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
  incrementMessageCount,
  getTopMessageSenders,
  updateVoiceTime,
  getTopVoiceUsers,
  getUserVoiceTime,
  query,
  addVoiceSessionToStats,
  addVoiceSessionToChannelStats,
  incrementChannelMessageCount
};