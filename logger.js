const { createLogger, format, transports } = require('winston');
const config = require('./config');

/**
 * Creates a Winston logger instance with the specified label
 * @param {string} label - The label to identify the logger instance
 * @returns {winston.Logger} Configured Winston logger instance
 * @throws {Error} If label is invalid or logger creation fails
 */
function getLogger(label) {
  if (!label || typeof label !== 'string') {
    throw new Error('Invalid logger label provided.');
  }

  try {
    return createLogger({
      level: config.logLevel,
      format: format.combine(
        format.label({ label }),
        format.timestamp(),
        format.printf(({ timestamp, level, message, label, ...meta }) => {
          let formattedMessage = message;
          if (meta && meta.args && Array.isArray(meta.args)) {
            formattedMessage = message.replace(/%[sd]/g, () => meta.args.shift());
          }
          return `${timestamp} - [${label}] - [${level.toUpperCase()}] - ${formattedMessage} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [new transports.Console()]
    });
  } catch (error) {
    console.error('Failed to create logger:', error);
    throw new Error('Failed to create logger instance.');
  }
}

module.exports = getLogger;
