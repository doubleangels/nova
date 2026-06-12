const { captureError, closeSentry } = require('./instrument');
const { serializeError } = require('./utils/logSanitize');
const { Client, Collection, GatewayIntentBits, Options } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');

// Configure global HTTP and HTTPS Keep-Alive agents for Axios
const http = require('http');
const https = require('https');
const axios = require('axios');
axios.defaults.httpAgent = new http.Agent({ keepAlive: true });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });

if (config.baseEmbedColor) {
  logger.info(`Base embed color was loaded as 0x${config.baseEmbedColor.toString(16).toUpperCase()}.`);
} else {
  logger.warn('BASE_EMBED_COLOR not set. Embed colors will use Discord defaults.');
}

/** @type {GatewayIntentBits[]} Bot intents required for functionality */
const BOT_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessageReactions,
];

/** @type {Client} Discord client instance */
const client = new Client({
  intents: BOT_INTENTS,
  makeCache: Options.cacheWithLimits({
    MessageManager: 50,
    ThreadManager: 50,
    GuildMemberManager: 50,
    UserManager: 50,
    PresenceManager: 0,
    VoiceStateManager: 0,
    ReactionManager: 50,
  })
});

/** @type {Collection<string, Command>} Collection of registered commands */
client.commands = new Collection();

const { closeDatabaseConnections } = require('./utils/database');
const { stopWorldCupScheduler, waitForWorldCupPollDrain } = require('./utils/worldCupScheduler');
const { stopFootballScheduler, waitForFootballPollDrain } = require('./utils/footballScheduler');
const { clearAllScheduledMuteKicks } = require('./utils/muteModeUtils');
const { cancelAllReminderTimeouts } = require('./utils/reminderUtils');

const deployCommands = require('./deploy-commands');
if (config.settings.deployCommandsOnStart) {
  deployCommands()
    .then(() => logger.info('Slash commands deployed on startup.'))
    .catch(err => logger.error('Failed to deploy slash commands on startup.', serializeError(err, { includeStack: true })));
} else {
  logger.info('Skipping slash command deploy on startup (deployCommandsOnStart is false).');
}

/**
 * Loads all command files from the commands directory
 * @type {string} Path to the commands directory
 */
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));
    if (config.settings.disabledCommands.includes(command.data.name)) {
      logger.info('Skipping disabled command.', { command: command.data.name });
      continue;
    }
    client.commands.set(command.data.name, command);
    logger.info('Loaded command.', { command: command.data.name });
  } catch (error) {
    captureError(error, { source: 'commandLoad', file });
    logger.error('Error occurred while loading command file.', {
      file,
      ...serializeError(error, { includeStack: true })
    });
  }
}

/**
 * Loads all event files from the events directory
 * @type {string} Path to the events directory
 */
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  try {
    const event = require(path.join(eventsPath, file));

    const safeExecute = (...args) =>
      Promise.resolve(event.execute(...args)).catch((error) => {
        captureError(error, { event: event.name, source: 'eventExecute' });
        logger.error('Unhandled error escaped event handler.', {
          event: event.name,
          ...serializeError(error, { includeStack: true })
        });
      });

    if (event.once) {
      client.once(event.name, safeExecute);
    } else {
      client.on(event.name, safeExecute);
    }
    logger.info('Loaded event.', { event: event.name });
  } catch (error) {
    captureError(error, { source: 'eventLoad', file });
    logger.error('Error occurred while loading event file.', {
      file,
      ...serializeError(error, { includeStack: true })
    });
  }
}

client.login(config.token).catch((err) => {
  captureError(err, { handler: 'clientLogin' });
  logger.error('Failed to log in to Discord.', serializeError(err, { includeStack: true }));
  closeSentry().finally(() => process.exit(1));
});

/**
 * Last-resort safety net: catches any exception that escapes all try-catch blocks.
 * Sentry's built-in integrations also handle these, but explicit handlers ensure
 * we flush before the process exits.
 */
process.on('uncaughtException', (error) => {
  captureError(error, { handler: 'uncaughtException' });
  logger.error('Uncaught exception — process will exit.', serializeError(error, { includeStack: true }));
  closeSentry().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  captureError(err, { handler: 'unhandledRejection' });
  logger.error('Unhandled promise rejection.', serializeError(err, { includeStack: true }));
});

let shutdownInProgress = false;

/**
 * Handles graceful shutdown
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  logger.info('Shutdown signal received.', { signal });
  if (client.cleanupInterval) {
    clearInterval(client.cleanupInterval);
  }
  if (client.heartbeatInterval) {
    clearInterval(client.heartbeatInterval);
  }
  stopWorldCupScheduler();
  stopFootballScheduler();
  await Promise.all([
    waitForWorldCupPollDrain(),
    waitForFootballPollDrain()
  ]);
  clearAllScheduledMuteKicks();
  cancelAllReminderTimeouts();
  try {
    client.destroy();
  } catch (err) {
    logger.error('Error destroying Discord client on shutdown.', serializeError(err, { includeStack: true }));
  }
  try {
    closeDatabaseConnections();
  } catch (err) {
    logger.error('Error closing database connections on shutdown.', serializeError(err, { includeStack: true }));
  }
  try {
    await closeSentry();
  } catch (err) {
    logger.error('Error flushing Sentry on shutdown.', serializeError(err, { includeStack: true }));
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
