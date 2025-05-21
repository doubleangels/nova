const { createLogger, format, transports } = require('winston');
const config = require('./config');

/**
 * We return a configured Winston logger with the specified label.
 *
 * @param {string} label - The label to associate with log messages.
 * @returns {Logger} A Winston logger instance.
 */
function getLogger(label) {
  if (!label || typeof label !== 'string') {
    throw new Error('Invalid logger label provided');
  }

  try {
    return createLogger({
      level: config.logLevel, // We set the log level from the config (e.g., 'debug', 'info').
      format: format.combine(
        // We attach a label to each log message.
        format.label({ label }),
        // We add a timestamp to each log message.
        format.timestamp(),
        // We define the log message format.
        format.printf(({ timestamp, level, message, label, ...meta }) => {
          // We build the log message string with timestamp, label, level, message, and additional metadata (if any).
          return `${timestamp} - [${label}] - [${level.toUpperCase()}] - ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      // We output log messages to the console.
      transports: [new transports.Console()]
    });
  } catch (error) {
    console.error('Failed to create logger:', error);
    throw new Error('Failed to create logger instance');
  }
}

module.exports = getLogger;
