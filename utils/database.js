const { Pool } = require('pg');
const logger = require('../logger')('database.js');
const dayjs = require('dayjs');
const config = require('../config');

// Database configuration constants.
const SCHEMA = 'main';
const DEFAULT_QUERY_TIMEOUT = 30000; // 30 seconds timeout for queries
const CONNECTION_OPTIONS = {
  connectionString: config.neonConnectionString,
  ssl: {
    rejectUnauthorized: true 
  },
  query_timeout: DEFAULT_QUERY_TIMEOUT
};

// Initialize the PostgreSQL client with connection details from config.
const pool = new Pool(CONNECTION_OPTIONS);

// Table names for consistent reference.
const TABLES = {
  CONFIG: `${SCHEMA}.config`,
  REMINDERS: `${SCHEMA}.reminders`,
  TRACKED_MEMBERS: `${SCHEMA}.tracked_members`,
  TIMEZONES: `${SCHEMA}.timezones`
};

/**
 * Initializes the database by creating necessary tables if they don't exist.
 */
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    logger.info("Initializing database tables in schema 'main'...");
    
    // Create schema if it doesn't exist.
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA};`);
    
    // Create config table.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLES.CONFIG} (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    
    // Create reminders table.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLES.REMINDERS} (
        key TEXT PRIMARY KEY,
        scheduled_time TEXT NOT NULL,
        reminder_id TEXT NOT NULL
      );
    `);
    
    // Create tracked_members table.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLES.TRACKED_MEMBERS} (
        member_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        join_time TEXT NOT NULL
      );
    `);
    
    logger.info("Database initialization complete.");
  } catch (err) {
    logger.error("Error initializing database:", { error: err });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retrieves a value from the 'config' table based on a given key.
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
    // Parse the value if it exists.
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
 * Inserts a new record if the key does not exist; otherwise, updates the existing record.
 *
 * @param {string} key - The key to set.
 * @param {any} value - The value to store, which will be serialized to JSON.
 */
async function setValue(key, value) {
  const client = await pool.connect();
  try {
    logger.debug(`Setting config value for key "${key}".`);
    const serialized = JSON.stringify(value);
    
    // Use upsert pattern instead of separate get and set operations.
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
 * Inserts a new record if none exists; otherwise, updates the existing record.
 *
 * @param {string} key - The reminder key.
 * @param {string} scheduled_time - The scheduled time as an ISO string.
 * @param {string} reminder_id - A unique identifier for the reminder.
 */
async function setReminderData(key, scheduled_time, reminder_id) {
  const client = await pool.connect();
  try {
    logger.debug(`Setting reminder data for key "${key}".`);
    
    // Use upsert pattern for better performance.
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
    
    // Using ON CONFLICT for upsert functionality.
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
 *
 * @param {string} memberId - The Discord member ID.
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
    } else {
      logger.info(`Successfully removed tracking data for member ID "${memberId}".`);
    }
  } catch (err) {
    logger.error("Error removing tracked member:", { error: err });
  } finally {
    client.release();
  }
}

/**
 * Retrieves all tracked members from the 'tracked_members' table.
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
 * Uses an "upsert" operation (INSERT ON CONFLICT DO UPDATE).
 *
 * @param {string} memberId - The Discord member ID (passed as a string).
 * @param {string} timezone - The timezone string (e.g., 'America/New_York').
 */
async function setUserTimezone(memberId, timezone) {
  const client = await pool.connect();
  try {
    // Validate timezone - should be a non-empty string.
    if (typeof timezone !== 'string' || timezone.trim() === '') {
        throw new Error(`Invalid timezone provided: ${timezone}`);
    }
     // Validate memberId - should be a non-empty string representing a large integer.
    if (typeof memberId !== 'string' || memberId.trim() === '' || !/^\d+$/.test(memberId)) {
        throw new Error(`Invalid memberId provided (must be a string representing an integer): ${memberId}`);
    }

    logger.debug(`Setting timezone for member ID "${memberId}" to "${timezone}".`);

    // Note: member_id column is BIGINT, timezone is TEXT.
    const query = `
      INSERT INTO ${TABLES.TIMEZONES} (member_id, timezone)
      VALUES ($1::bigint, $2) -- Explicit cast of $1 to bigint
      ON CONFLICT (member_id)
      DO UPDATE SET timezone = $2;
    `;
    // Pass memberId as a string; pg driver handles conversion correctly with cast.
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
 *
 * @param {string} memberId - The Discord member ID (passed as a string).
 * @returns {Promise<string|null>} The timezone string if found, otherwise null.
 */
async function getUserTimezone(memberId) {
  const client = await pool.connect();
  try {
    // Validate memberId - should be a non-empty string representing a large integer.
    if (typeof memberId !== 'string' || memberId.trim() === '' || !/^\d+$/.test(memberId)) {
        logger.warn(`Attempted to get timezone with invalid memberId format: ${memberId}`);
        return null; // Return null for invalid format.
    }

    logger.debug(`Getting timezone for member ID "${memberId}".`);

    // Note: member_id column is BIGINT.
    const result = await client.query(
      `SELECT timezone FROM ${TABLES.TIMEZONES} WHERE member_id = $1::bigint`, // Explicit cast.
      [memberId] // Pass memberId as string.
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
    return null; // Return null on error.
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
};
