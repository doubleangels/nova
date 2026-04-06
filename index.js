const { captureError, closeSentry } = require('./instrument');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');

// Log the base embed color on startup for debugging
if (config.baseEmbedColor) {
  logger.info(`Base embed color loaded: 0x${config.baseEmbedColor.toString(16).toUpperCase()} (from BASE_EMBED_COLOR="${process.env.BASE_EMBED_COLOR}")`);
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
  intents: BOT_INTENTS
});

/** @type {Collection<string, Command>} Collection of registered commands */
client.commands = new Collection();

/** @type {Map<string, Array>} Map of conversation histories for users */
client.conversationHistory = new Map();

const deployCommands = require('./deploy-commands');
deployCommands().then(() => logger.info('Slash commands deployed on startup.')).catch(err => logger.error('Failed to deploy slash commands on startup:', err));

/**
 * Loads all command files from the commands directory
 * @type {string} Path to the commands directory
 */
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
    logger.info(`Loaded command: ${command.data.name}`);
  } catch (error) {
    captureError(error, { source: 'commandLoad', file });
    logger.error(`Error loading command file: ${file}`, {
      error: error.stack,
      message: error.message
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

    // Wrap execute so any error that escapes the event's own try/catch is still captured.
    const safeExecute = (...args) =>
      Promise.resolve(event.execute(...args)).catch((error) => {
        captureError(error, { event: event.name, source: 'eventExecute' });
        logger.error(`Unhandled error escaped event handler: ${event.name}`, { err: error });
      });

    if (event.once) {
      client.once(event.name, safeExecute);
    } else {
      client.on(event.name, safeExecute);
    }
    logger.info(`Loaded event: ${event.name}`);
  } catch (error) {
    captureError(error, { source: 'eventLoad', file });
    logger.error(`Error loading event file: ${file}`, {
      error: error.stack,
      message: error.message
    });
  }
}

client.login(config.token);

/**
 * Last-resort safety net: catches any exception that escapes all try-catch blocks.
 * Sentry's built-in integrations also handle these, but explicit handlers ensure
 * we flush before the process exits.
 */
process.on('uncaughtException', (error) => {
  captureError(error, { handler: 'uncaughtException' });
  logger.error('Uncaught exception — process will exit.', { err: error });
  closeSentry().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  captureError(err, { handler: 'unhandledRejection' });
  logger.error('Unhandled promise rejection.', { err });
});

/**
 * Handles graceful shutdown on SIGINT signal
 */
process.on('SIGINT', async () => {
  logger.info('Shutdown signal (SIGINT) received. Exiting...');
  try {
    await closeSentry();
  } catch (err) {
    logger.error('Error flushing Sentry on shutdown.', { err });
  }
  process.exit(0);
});

/**
 * Handles graceful shutdown on SIGTERM signal
 */
process.on('SIGTERM', async () => {
  logger.info('Shutdown signal (SIGTERM) received. Exiting...');
  try {
    await closeSentry();
  } catch (err) {
    logger.error('Error flushing Sentry on shutdown.', { err });
  }
  process.exit(0);
});