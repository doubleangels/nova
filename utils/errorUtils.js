const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');

/**
 * Logs an error with additional context and sends it to Sentry
 * @param {Error} error - The error object to log
 * @param {string} context - The context where the error occurred (e.g., event name)
 * @param {Object} [metadata={}] - Additional metadata to include with the error
 */
function logError(error, context, metadata = {}) {
  // Log to console with context
  logger.error(`Error in ${context}:`, {
    error: error.message || error.toString(),
    stack: error.stack,
    ...metadata
  });

  // Send to Sentry with additional context
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