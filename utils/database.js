const { Pool } = require('pg');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const config = require('../config');

// We define these configuration constants for database connectivity and operations.
const SCHEMA = 'main';
const DEFAULT_QUERY_TIMEOUT = 30000; // We set a 30-second timeout for queries to prevent hanging operations.
const CONNECTION_OPTIONS = {
  connectionString: config.neonConnectionString,
  ssl: {
    rejectUnauthorized: true 
  },
  query_timeout: DEFAULT_QUERY_TIMEOUT
};

// We initialize the PostgreSQL client with connection details from our configuration.
const pool = new Pool(CONNECTION_OPTIONS);

// We define table names for consistent reference throughout the codebase.
const TABLES = {
  CONFIG: `${SCHEMA}.config`,
  REMINDERS: `${SCHEMA}.reminders`,
  TRACKED_MEMBERS: `${SCHEMA}.tracked_members`,
  TIMEZONES: `${SCHEMA}.timezones`,
  MESSAGE_COUNTS: `${SCHEMA}.message_counts`,
  VOICE_TIME: `${SCHEMA}.voice_time`
};

/**
 * Initializes the database by performing a simple read/write test.
 * We ensure our database connection is working properly.
 */
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    logger.info("Testing database connection...");
    
    // We perform a simple read/write test using the config table
    const testKey = 'db_test_key';
    const testValue = 'test_value';
    
    // Write test
    await client.query(
      `INSERT INTO ${TABLES.CONFIG} (id, value) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET value = $2`,
      [testKey, JSON.stringify(testValue)]
    );
    
    // Read test
    const result = await client.query(
      `SELECT value FROM ${TABLES.CONFIG} WHERE id = $1`,
      [testKey]
    );
    
    if (result.rows.length > 0 && JSON.parse(result.rows[0].value) === testValue) {
      logger.info("Database connection test successful.");
    } else {
      throw new Error("Database read/write test failed");
    }
  } catch (err) {
    logger.error("Error testing database connection:", { error: err });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retrieves a value from the 'config' table based on a given key.
 * We use this to access stored configuration settings.
 *
 * @param {string} key - The key to retrieve.
 * @returns {Promise<any|null>} The parsed value if found, otherwise null.
 */
async function getValue(key) {
  const client = await pool.connect();
  try {
    logger.debug(`Getting config value for key "${key}".`);
    const result = await client.query(
      `SELECT value FROM ${TABLES.CONFIG} WHERE id = $1`,
      [key]
    );
    // We parse the value if it exists to convert from JSON string to JavaScript object.
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
 * Sets a value in the 'config' table for a given key.
 * We use this to store configuration settings, inserting a new record or updating an existing one.
 *
 * @param {string} key - The key to set.
 * @param {any} value - The value to store, which will be serialized to JSON.
 */
async function setValue(key, value) {
  const client = await pool.connect();
  try {
    logger.debug(`Setting config value for key "${key}".`);
    const serialized = JSON.stringify(value);
    
    // We use an upsert pattern for efficiency instead of separate get and set operations.
    await client.query(
      `INSERT INTO ${TABLES.CONFIG} (id, value) VALUES ($1, $2)
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
 * Deletes a value from the 'config' table for a given key.
 * We use this to remove configuration settings that are no longer needed.
 *
 * @param {string} key - The key to delete.
 */
async function deleteValue(key) {
  const client = await pool.connect();
  try {
    logger.debug(`Deleting config for key "${key}".`);
    await client.query(`DELETE FROM ${TABLES.CONFIG} WHERE id = $1`, [key]);
    logger.debug(`Deleted config for key "${key}".`);
  } catch (err) {
    logger.error(`Error deleting key "${key}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Retrieves all configuration records from the 'config' table.
 * We use this to get a complete view of all settings at once.
 *
 * @returns {Promise<Array<Object>>} An array of config objects.
 */
async function getAllConfigs() {
  const client = await pool.connect();
  try {
    logger.debug("Retrieving all config records.");
    const result = await client.query(`SELECT * FROM ${TABLES.CONFIG}`);
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
 * Retrieves reminder data from the 'reminders' table for a given key.
 * We use this to check if a reminder exists and when it's scheduled.
 *
 * @param {string} key - The reminder key.
 * @returns {Promise<Object|null>} The reminder data if found, otherwise null.
 */
async function getReminderData(key) {
  const client = await pool.connect();
  try {
    logger.debug(`Getting reminder data for key "${key}".`);
    const result = await client.query(
      `SELECT scheduled_time, reminder_id FROM ${TABLES.REMINDERS} WHERE key = $1`,
      [key]
    );
    const data = result.rows.length > 0 ? result.rows[0] : null;
    logger.debug(`Reminder data for key "${key}": ${JSON.stringify(data)}`);
    return data;
  } catch (err) {
    logger.error(`Error getting reminder data for key "${key}":`, { error: err });
    return null;
  } finally {
    client.release();
  }
}

/**
 * Sets reminder data in the 'reminders' table for a given key.
 * We use this to schedule reminders, inserting a new record or updating an existing one.
 *
 * @param {string} key - The reminder key.
 * @param {string} scheduled_time - The scheduled time as an ISO string.
 * @param {string} reminder_id - A unique identifier for the reminder.
 */
async function setReminderData(key, scheduled_time, reminder_id) {
  const client = await pool.connect();
  try {
    logger.debug(`Setting reminder data for key "${key}".`);
    
    // We use an upsert pattern for better performance and code simplicity.
    await client.query(
      `INSERT INTO ${TABLES.REMINDERS} (key, scheduled_time, reminder_id) 
       VALUES ($1, $2, $3)
       ON CONFLICT (key) 
       DO UPDATE SET scheduled_time = $2, reminder_id = $3`,
      [key, scheduled_time, reminder_id]
    );
    logger.info(`Set reminder data for key "${key}" successfully.`);
  } catch (err) {
    logger.error(`Error setting reminder data for key "${key}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Deletes reminder data from the 'reminders' table for a given key.
 * We use this to clean up reminders that have been triggered or cancelled.
 *
 * @param {string} key - The reminder key.
 */
async function deleteReminderData(key) {
  const client = await pool.connect();
  try {
    logger.debug(`Deleting reminder data for key "${key}".`);
    await client.query(`DELETE FROM ${TABLES.REMINDERS} WHERE key = $1`, [key]);
    logger.info(`Deleted reminder data for key "${key}".`);
  } catch (err) {
    logger.error(`Error deleting reminder data for key "${key}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Tracks a new member by inserting or updating their information in the 'tracked_members' table.
 * We use this for mute mode verification to ensure members send a message before a deadline.
 *
 * @param {string} memberId - The Discord member ID.
 * @param {string} username - The username of the member.
 * @param {string} joinTime - The ISO string representing when the member joined.
 */
async function trackNewMember(memberId, username, joinTime) {
  const client = await pool.connect();
  try {
    const formattedJoinTime = dayjs(joinTime).toISOString();
    logger.debug(`Tracking new member "${username}" (ID: ${memberId}) joining at ${formattedJoinTime}.`);
    
    // We use ON CONFLICT for upsert functionality to simplify the code.
    await client.query(
      `INSERT INTO ${TABLES.TRACKED_MEMBERS} (member_id, join_time, username) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (member_id) 
       DO UPDATE SET join_time = $2, username = $3`,
      [memberId, formattedJoinTime, username]
    );
    
    logger.info(`Successfully tracked member "${username}" (ID: ${memberId}).`);
  } catch (err) {
    logger.error(`Error tracking new member "${username}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Retrieves tracking data for a specific member from the 'tracked_members' table.
 * We use this to check if a member is being monitored in mute mode.
 *
 * @param {string} memberId - The Discord member ID.
 * @returns {Promise<Object|null>} The tracking data if found, otherwise null.
 */
async function getTrackedMember(memberId) {
  const client = await pool.connect();
  try {
    logger.debug(`Retrieving tracking data for member ID "${memberId}".`);
    const result = await client.query(
      `SELECT * FROM ${TABLES.TRACKED_MEMBERS} WHERE member_id = $1`,
      [memberId]
    );
    
    if (result.rows.length > 0) {
      logger.debug(`Found tracking data for member ID "${memberId}": ${JSON.stringify(result.rows[0])}`);
      return result.rows[0];
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
 * Removes tracking data for a specific member from the 'tracked_members' table.
 * We use this when a member sends a message (verification) or leaves the server.
 *
 * @param {string} memberId - The Discord member ID.
 * @returns {Promise<boolean>} True if a record was removed, false otherwise.
 */
async function removeTrackedMember(memberId) {
  const client = await pool.connect();
  try {
    logger.debug(`Removing tracking data for member ID "${memberId}".`);
    const result = await client.query(
      `DELETE FROM ${TABLES.TRACKED_MEMBERS} WHERE member_id = $1 RETURNING *`,
      [memberId]
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
 * Retrieves all tracked members from the 'tracked_members' table.
 * We use this to check all members being monitored in mute mode, typically after a bot restart.
 *
 * @returns {Promise<Array<Object>>} An array of objects containing member_id, username, and join_time.
 */
async function getAllTrackedMembers() {
  const client = await pool.connect();
  try {
    logger.debug("Retrieving all tracked members.");
    const result = await client.query(
      `SELECT member_id, username, join_time FROM ${TABLES.TRACKED_MEMBERS}`
    );
    logger.info(`Retrieved ${result.rows.length} tracked member(s).`);
    return result.rows;
  } catch (err) {
    logger.error("Error retrieving all tracked members:", { error: err });
    return [];
  } finally {
    client.release();
  }
}

/**
 * Sets or updates the timezone for a given Discord member ID.
 * We use this to store user timezone preferences for time conversion features.
 *
 * @param {string} memberId - The Discord member ID (passed as a string).
 * @param {string} timezone - The timezone string (e.g., 'America/New_York').
 */
async function setUserTimezone(memberId, timezone) {
  const client = await pool.connect();
  try {
    // We validate the timezone to ensure it's a non-empty string.
    if (typeof timezone !== 'string' || timezone.trim() === '') {
        throw new Error(`Invalid timezone provided: ${timezone}`);
    }
    // We validate the memberId to ensure it's a string representing a large integer.
    if (typeof memberId !== 'string' || memberId.trim() === '' || !/^\d+$/.test(memberId)) {
        throw new Error(`Invalid memberId provided (must be a string representing an integer): ${memberId}`);
    }

    logger.debug(`Setting timezone for member ID "${memberId}" to "${timezone}".`);

    // We use an explicit cast to bigint since member_id column is BIGINT and timezone is TEXT.
    const query = `
      INSERT INTO ${TABLES.TIMEZONES} (member_id, timezone)
      VALUES ($1::bigint, $2) -- Explicit cast of $1 to bigint
      ON CONFLICT (member_id)
      DO UPDATE SET timezone = $2;
    `;
    // We pass memberId as a string; the pg driver handles conversion correctly with the cast.
    await client.query(query, [memberId, timezone.trim()]);

    logger.info(`Successfully set timezone for member ID "${memberId}".`);
  } catch (err) {
    logger.error(`Error setting timezone for member ID "${memberId}":`, { error: err });
  } finally {
    client.release();
  }
}

/**
 * Retrieves the timezone for a given Discord member ID.
 * We use this to get a user's preferred timezone for time conversion features.
 *
 * @param {string} memberId - The Discord member ID (passed as a string).
 * @returns {Promise<string|null>} The timezone string if found, otherwise null.
 */
async function getUserTimezone(memberId) {
  const client = await pool.connect();
  try {
    // We validate the memberId to ensure it's a string representing a large integer.
    if (typeof memberId !== 'string' || memberId.trim() === '' || !/^\d+$/.test(memberId)) {
        logger.warn(`Attempted to get timezone with invalid memberId format: ${memberId}`);
        return null; // We return null for invalid format to prevent database errors.
    }

    logger.debug(`Getting timezone for member ID "${memberId}".`);

    // We use an explicit cast since member_id column is BIGINT.
    const result = await client.query(
      `SELECT timezone FROM ${TABLES.TIMEZONES} WHERE member_id = $1::bigint`, // Explicit cast.
      [memberId] // We pass memberId as string; the pg driver handles conversion with the cast.
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
    return null; // We return null on error to prevent application crashes.
  } finally {
    client.release();
  }
}

/**
 * Increments the message count for a user and updates their username if it has changed.
 * 
 * @param {string} memberId - The Discord member ID.
 * @param {string} username - The current username of the member.
 * @returns {Promise<void>}
 */
async function incrementMessageCount(memberId, username) {
  const client = await pool.connect();
  try {
    logger.debug(`Incrementing message count for member "${username}" (ID: ${memberId}).`);
    
    await client.query(`
      INSERT INTO ${TABLES.MESSAGE_COUNTS} (member_id, username, message_count)
      VALUES ($1, $2, 1)
      ON CONFLICT (member_id) 
      DO UPDATE SET 
        message_count = ${TABLES.MESSAGE_COUNTS}.message_count + 1,
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
 * Gets the top message senders in the server.
 * 
 * @param {number} limit - The maximum number of users to return.
 * @returns {Promise<Array<Object>>} Array of objects containing member_id, username, and message_count.
 */
async function getTopMessageSenders(limit = 10) {
  const client = await pool.connect();
  try {
    logger.debug(`Retrieving top ${limit} message senders.`);
    
    const result = await client.query(`
      SELECT member_id, username, message_count
      FROM ${TABLES.MESSAGE_COUNTS}
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
 * Updates or creates a voice time tracking record for a user.
 * We track the total time spent in voice channels.
 * 
 * @param {string} memberId - The Discord user ID.
 * @param {string} username - The current username of the user.
 * @param {number} minutesSpent - The number of minutes to add to their total.
 * @returns {Promise<void>}
 */
async function updateVoiceTime(memberId, username, minutesSpent) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ${TABLES.VOICE_TIME} (member_id, username, minutes_spent, last_updated)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (member_id) DO UPDATE SET
         username = $2,
         minutes_spent = ${TABLES.VOICE_TIME}.minutes_spent + $3,
         last_updated = CURRENT_TIMESTAMP`,
      [memberId, username, minutesSpent]
    );
  } finally {
    client.release();
  }
}

/**
 * Gets the top voice channel users by time spent.
 * We retrieve users sorted by their total voice time.
 * 
 * @param {number} limit - The maximum number of users to return.
 * @returns {Promise<Array>} Array of user records with voice time data.
 */
async function getTopVoiceUsers(limit = 10) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT member_id, username, minutes_spent, last_updated
       FROM ${TABLES.VOICE_TIME}
       ORDER BY minutes_spent DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Gets the voice time for a specific user.
 * We retrieve the total time spent in voice channels.
 * 
 * @param {string} memberId - The Discord user ID.
 * @returns {Promise<Object|null>} The user's voice time record or null if not found.
 */
async function getUserVoiceTime(memberId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT member_id, username, minutes_spent, last_updated
       FROM ${TABLES.VOICE_TIME}
       WHERE member_id = $1`,
      [memberId]
    );
    return result.rows[0] || null;
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
  getReminderData,
  setReminderData,
  deleteReminderData,
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
  getUserVoiceTime
};