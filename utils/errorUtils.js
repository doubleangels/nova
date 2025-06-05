const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const Sentry = require('../sentry');

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