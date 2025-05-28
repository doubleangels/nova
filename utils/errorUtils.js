const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');

/**
 * We log errors with additional context and send them to Sentry for monitoring.
 * This function provides a standardized way to handle error logging across the application.
 * 
 * @param {Error} error - The error object to log
 * @param {string} context - The context where the error occurred (e.g., event name)
 * @param {Object} [metadata={}] - Additional metadata to include with the error
 */
function logError(error, context, metadata = {}) {
  // We log the error to the console with full context and stack trace
  logger.error(`Error in ${context}:`, {
    error: error.message || error.toString(),
    stack: error.stack,
    ...metadata
  });

  // We send the error to Sentry with additional context for monitoring
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