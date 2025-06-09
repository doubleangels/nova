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
  // Log to application logger
  logger.error(`Error in ${context}:`, {
    error: error.message || error.toString(),
    stack: error.stack,
    ...metadata
  });

  // Log to Sentry with additional context
  Sentry.captureException(error, {
    extra: {
      context,
      ...metadata
    },
    tags: {
      context,
      errorType: error.name,
      errorCode: error.code
    }
  });
}

/**
 * Logs a warning to both the application logger and Sentry.
 * @function logWarning
 * @param {string} message - The warning message
 * @param {string} context - The context where the warning occurred
 * @param {Object} [metadata={}] - Additional metadata to include
 */
function logWarning(message, context, metadata = {}) {
  // Log to application logger
  logger.warn(`Warning in ${context}: ${message}`, metadata);

  // Log to Sentry as a warning
  Sentry.captureMessage(message, {
    level: 'warning',
    extra: {
      context,
      ...metadata
    }
  });
}

module.exports = {
  logError,
  logWarning
}; 