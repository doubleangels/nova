const { Pool } = require('pg');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const config = require('../config');

const DB_TABLES = {
  CONFIG: 'main.config',
  REMINDERS: 'main.reminder_data',
  TRACKED_MEMBERS: 'main.tracked_members',
  TIMEZONES: 'main.timezones',
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

async function addMuteModeUser(userId, username) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ${DB_TABLES.MUTE_MODE_RECOVERY} (user_id, username, join_time)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET username = $2, join_time = NOW()`,
      [userId, username]
    );
  } finally {
    client.release();
  }
}

async function removeMuteModeUser(userId) {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM ${DB_TABLES.MUTE_MODE_RECOVERY} WHERE user_id = $1`,
      [userId]
    );
  } finally {
    client.release();
  }
}

async function getAllMuteModeUsers() {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM ${DB_TABLES.MUTE_MODE_RECOVERY}`);
    return res.rows;
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
  setUserTimezone,
  getUserTimezone,
  query,
  addMuteModeUser,
  removeMuteModeUser,
  getAllMuteModeUsers
};