const Sentry = require("@sentry/node");
const path = require('path');
const logger = require('./logger')(path.basename(__filename));

// Initialize Sentry for error tracking and performance monitoring.
Sentry.init({
  dsn: "https://11b0fbce04a61c3cf602b4c2ab444c83@o244019.ingest.us.sentry.io/4508695162060800",
  tracesSampleRate: 1.0, // Capture all trace data.
});
logger.info("Sentry initialized with performance monitoring.");

// Export the configured Sentry instance
module.exports = Sentry;