const { createLogger, format, transports } = require('winston');
const config = require('./config');

const logger = createLogger({
  level: config.logLevel,
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} - [${level.toUpperCase()}] - ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new transports.Console()
  ]
});

module.exports = logger;