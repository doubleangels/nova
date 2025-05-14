const { Pool } = require('pg');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const Sentry = require('../sentry');

/**
 * We create a connection pool to manage database connections efficiently.
 * This allows us to reuse connections and handle multiple concurrent requests.
 */
const pool = new Pool({
  connectionString: config.database.url,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false
});

/**
 * We initialize the database by creating necessary tables if they don't exist.
 * This ensures our database schema is properly set up before the bot starts.
 */
async function initializeDatabase() {
  try {
    // We create the recovery table to track voice channel join times.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS main.voice_recovery (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        joined_at TIMESTAMP WITH TIME ZONE NOT NULL,
        left_at TIMESTAMP WITH TIME ZONE,
        duration BIGINT,
        UNIQUE(user_id, guild_id, joined_at)
      )
    `);
    
    logger.info("Database initialization completed successfully.");
  } catch (error) {
    logger.error("Failed to initialize database:", { error });
    Sentry.captureException(error, {
      extra: { function: 'initializeDatabase' }
    });
    throw error;
  }
}

/**
 * We execute a database query and return all results.
 * This is used for SELECT queries where we expect multiple rows.
 * 
 * @param {string} text - The SQL query text.
 * @param {Array} params - The query parameters.
 * @returns {Promise<QueryResult>} The query results.
 */
async function query(text, params) {
  try {
    const start = Date.now();
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    // We log slow queries for performance monitoring.
    if (duration > 1000) {
      logger.warn("Slow query detected:", { 
        text, 
        duration, 
        rows: result.rowCount 
      });
    }
    
    return result;
  } catch (error) {
    logger.error("Database query error:", { error, text });
    Sentry.captureException(error, {
      extra: { 
        function: 'query',
        query: text
      }
    });
    throw error;
  }
}

/**
 * We execute a database query and return a single result.
 * This is used for SELECT queries where we expect one row.
 * 
 * @param {string} text - The SQL query text.
 * @param {Array} params - The query parameters.
 * @returns {Promise<Object>} The first row of the query results.
 */
async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows[0];
}

// We export our database functions for use throughout the application.
module.exports = {
  initializeDatabase,
  query,
  queryOne
};