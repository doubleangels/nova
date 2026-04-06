/**
 * Sentry must load before other application modules (see @sentry/node docs).
 * Set SENTRY_DSN in the environment to enable reporting; without it the SDK stays disabled.
 */
require('dotenv').config();
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  sendDefaultPii: true,

  tracesSampleRate: 1.0,

  includeLocalVariables: true,

  enableLogs: true,

  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',

  release: process.env.SENTRY_RELEASE || undefined
});

/**
 * @returns {Promise<boolean>}
 */
function closeSentry() {
  return Sentry.close(2000);
}

module.exports = { Sentry, closeSentry };
