/**
 * Error utilities module for handling error logging and reporting.
 * Provides centralized error logging with Sentry integration.
 * @module utils/errorUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');

/**
 * Logs an error to both the application logger and Sentry.
 * @function logError
 * @param {Error} error - The error object to log
 * @param {string} context - The context where the error occurred
 * @param {Object} [metadata={}] - Additional metadata to include with the error
 */
function logError(error, context, metadata = {}) {
  logger.error(`Error in ${context}:`, {
    error: error.message || error.toString(),
    stack: error.stack,
    ...metadata
  });

  Sentry.captureException(error, {
    extra: {
      context,
      ...metadata
    }
  });
}

module.exports = {
  logError
}; 