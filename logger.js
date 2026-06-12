const pino = require('pino');
const config = require('./config');
const { sanitizeLogMeta } = require('./utils/logSanitize');

const baseLogger = pino({
  level: config.logLevel || 'info',
  redact: {
    paths: [
      'token',
      'apiKey',
      '*.apiKey',
      'openaiApiKey',
      'geminiApiKey',
      'anthropicApiKey',
      'deeplApiKey',
      'googleApiKey',
      'pirateWeatherApiKey',
      'redditClientSecret',
      'redditPassword',
      'omdbApiKey',
      'footballDataApiKey',
      'malClientId',
      'discordBotToken',
      'headers.authorization',
      'authorization',
      'password',
      'secret'
    ],
    censor: '[REDACTED]'
  },
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

/**
 * Creates a Pino logger instance with the specified label
 * @param {string} label - The label to identify the logger instance
 * @returns {pino.Logger} Configured Pino logger instance with label context
 * @throws {Error} If label is invalid or logger creation fails
 */
function getLogger(label) {
  if (!label || typeof label !== 'string') {
    throw new Error('Invalid logger label provided.');
  }

  try {
    const childLogger = baseLogger.child({ label });

    function write(level, message, meta) {
      const sanitizedMeta = meta && typeof meta === 'object' ? sanitizeLogMeta(meta) : meta;

      if (sanitizedMeta && typeof sanitizedMeta === 'object') {
        childLogger[level](sanitizedMeta, message);
      } else {
        childLogger[level](message);
      }
    }

    return {
      info: (message, meta) => {
        write('info', message, meta);
      },
      error: (message, meta) => {
        write('error', message, meta);
      },
      warn: (message, meta) => {
        write('warn', message, meta);
      },
      debug: (message, meta) => {
        write('debug', message, meta);
      },
      _pino: childLogger
    };
  } catch (error) {
    console.error('Failed to create logger.', error);
    throw new Error('Failed to create logger instance.');
  }
}

getLogger.sanitizeLogMeta = sanitizeLogMeta;
module.exports = getLogger;
