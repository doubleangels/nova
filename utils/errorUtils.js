/**
 * Error utilities module for handling error logging and reporting.
 * Provides centralized error logging with Sentry integration.
 * @module utils/errorUtils
 */

const logger = require('../logger')('errorUtils');

const ERROR_LEVEL_WARNING = 'warning';
const ERROR_LEVEL_ERROR = 'error';

const ERROR_TYPE_UNEXPECTED = 'unexpected';
const ERROR_TYPE_VALIDATION = 'validation';
const ERROR_TYPE_PERMISSION = 'permission';
const ERROR_TYPE_DATABASE = 'database';
const ERROR_TYPE_API = 'api';
const ERROR_TYPE_NETWORK = 'network';

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