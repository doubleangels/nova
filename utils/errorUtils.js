/**
 * Error utilities module for handling error logging and reporting.
 * Provides centralized error logging with Sentry integration.
 * @module utils/errorUtils
 */

const logger = require('../logger')('errorUtils');

/**
 * Logs an error to the application logger.
 * @param {string} message - The error message
 * @param {Error} error - The error object
 * @param {Object} [context] - Additional context for the error
 */
function logError(message, error, context = {}) {
  logger.error(message, {
    error: error?.stack,
    message: error?.message || String(error),
    ...context
  });
}

/**
 * Logs a warning to the application logger.
 * @param {string} message - The warning message
 * @param {Object} [context] - Additional context for the warning
 */
function logWarning(message, context = {}) {
  logger.warn(message, context);
}

module.exports = {
  logError,
  logWarning
}; 