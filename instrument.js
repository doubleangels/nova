/**
 * Sentry must load before other application modules (see @sentry/node docs).
 * Set SENTRY_DSN in the environment to enable reporting; without it the SDK stays disabled.
 */
require('dotenv').config();
const Sentry = require('@sentry/node');
const pkg = require('./package.json');

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  sendDefaultPii: true,

  tracesSampleRate: 1.0,

  includeLocalVariables: true,

  enableLogs: true,

  environment: process.env.NODE_ENV || 'production',

  release: `${pkg.name}@${pkg.version}`
});

/**
 * Captures an error to Sentry with consistent tagging.
 * Use this in every catch block instead of calling Sentry.captureException directly,
 * so all errors are reported and the call-site is a single, searchable pattern.
 *
 * @param {unknown} error - The caught error
 * @param {Record<string, string>} [tags] - Key-value tags attached to the Sentry event
 * @returns {unknown} The original error (for optional chaining)
 */
function captureError(error, tags = {}) {
  Sentry.captureException(error, { tags });
  return error;
}

/**
 * @returns {Promise<boolean>}
 */
function closeSentry() {
  return Sentry.close(2000);
}

module.exports = { Sentry, captureError, closeSentry };
