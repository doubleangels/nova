/**
 * Sentry error tracking module for the Discord bot.
 * Initializes and configures Sentry for error monitoring and reporting.
 * @module sentry
 */

const Sentry = require("@sentry/node");
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const { logError } = require('./errors');

/**
 * Error messages specific to Sentry operations.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred in Sentry.",
    SENTRY_INITIALIZATION_FAILED: "⚠️ Failed to initialize Sentry.",
    INVALID_DSN: "⚠️ Invalid Sentry DSN provided.",
    CONFIGURATION_FAILED: "⚠️ Failed to configure Sentry.",
    EVENT_CAPTURE_FAILED: "⚠️ Failed to capture event in Sentry.",
    SCOPE_SET_FAILED: "⚠️ Failed to set Sentry scope.",
    CONTEXT_SET_FAILED: "⚠️ Failed to set Sentry context.",
    USER_SET_FAILED: "⚠️ Failed to set Sentry user.",
    TAGS_SET_FAILED: "⚠️ Failed to set Sentry tags.",
    EXCEPTION_CAPTURE_FAILED: "⚠️ Failed to capture exception in Sentry.",
    CONFIG_MISSING: "⚠️ Required Sentry configuration missing."
};

try {
  Sentry.init({
    dsn: "https://11b0fbce04a61c3cf602b4c2ab444c83@o244019.ingest.us.sentry.io/4508695162060800",
    tracesSampleRate: 1.0,
  });
  logger.info("Sentry initialized!");
} catch (error) {
  logError('Failed to initialize Sentry', error);
  throw new Error(ERROR_MESSAGES.SENTRY_INITIALIZATION_FAILED);
}

module.exports = Sentry;