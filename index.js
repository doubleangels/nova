/**
 * Main entry point for the Discord bot.
 * Initializes the bot, loads commands and events, and handles startup/shutdown.
 * @module index
 */

const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');
const Sentry = require('./sentry');
const { initializeDatabase } = require('./utils/database');
const deployCommands = require('./deploy-commands');
const { logError } = require('./errors');

/**
 * Error messages specific to bot initialization and operation.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while running the bot.",
    BOT_STARTUP_FAILED: "⚠️ Failed to start the bot.",
    DATABASE_INITIALIZATION_FAILED: "⚠️ Failed to initialize database.",
    COMMAND_LOADING_FAILED: "⚠️ Failed to load commands.",
    EVENT_LOADING_FAILED: "⚠️ Failed to load events.",
    INVALID_EVENT_FILE: "⚠️ Invalid event file structure.",
    INVALID_COMMAND_FILE: "⚠️ Invalid command file structure.",
    TOKEN_INVALID: "⚠️ Invalid bot token provided.",
    CLIENT_INITIALIZATION_FAILED: "⚠️ Failed to initialize Discord client.",
    COMMAND_DEPLOYMENT_FAILED: "⚠️ Failed to deploy commands.",
    PERMISSION_DENIED: "⚠️ Insufficient permissions to perform operation.",
    CONFIG_MISSING: "⚠️ Required configuration missing.",
    SHUTDOWN_FAILED: "⚠️ Failed to shutdown bot gracefully."
};

const COMMAND_EXTENSION = '.js';
const EVENT_EXTENSION = '.js';
const SENTRY_FLUSH_TIMEOUT = 2000;

/**
 * Discord client instance with configured intents and partials.
 * @type {Client}
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

client.commands = new Collection();
client.buttonHandlers = new Collection();
client.selectHandlers = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(COMMAND_EXTENSION));

const disabledCommands = config.settings?.disabledCommands || [];
const hasDisabledCommands = Array.isArray(disabledCommands) && disabledCommands.length > 0;

if (hasDisabledCommands) {
  logger.info(`Using disabledCommands filter - we will not load ${disabledCommands.length} specified commands.`);
}

let loadedCount = 0;
let skippedCount = 0;

for (const file of commandFiles) {
  const commandName = file.replace(COMMAND_EXTENSION, ''); 
  
  if (hasDisabledCommands && disabledCommands.includes(commandName)) {
    logger.debug(`Skipping disabled command: ${commandName}.`);
    skippedCount++;
    continue;
  }
  
  try {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    client.commands.set(command.data.name, command);
    logger.info("Loaded command:", { command: command.data.name });
    loadedCount++;
  } catch (error) {
    logError('Failed to load command', error);
    Sentry.captureException(error, {
      extra: { context: 'command_loading_failure', commandName }
    });
  }
}

logger.info(`Command loading complete: ${loadedCount} loaded, ${skippedCount} skipped.`);

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(EVENT_EXTENSION));

for (const file of eventFiles) {
  try {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    
    if (!event.name || !event.execute) {
      throw new Error(ERROR_MESSAGES.INVALID_EVENT_FILE);
    }
    
    if (event.once) {
      client.once(event.name, (...args) => {
        logger.debug("Executing once event:", { event: event.name });
        event.execute(...args, client);
      });
    } else {
      client.on(event.name, (...args) => {
        if (event.name !== 'typingStart' && event.name !== 'presenceUpdate') {
          logger.debug("Executing event:", { event: event.name });
        }
        if (event.name === 'ready') {
          event.execute(...args, client);
        } else {
          event.execute(...args);
        }
      });
    }
    logger.info("Loaded event:", { event: event.name });
  } catch (error) {
    logError('Failed to load event', error);
    Sentry.captureException(error, {
      extra: { 
        context: 'event_loading_failure', 
        eventFile: file,
        errorDetails: error.message || error
      }
    });
  }
}

client.once('ready', async () => {
  try {
    await initializeDatabase();
    logger.info("Bot is online:", { tag: client.user.tag });
  } catch (error) {
    logError('Failed to initialize database:', error);
    Sentry.captureException(error, {
      extra: { context: 'database_initialization_failure' }
    });
    process.exit(1);
  }
});

/**
 * Starts the bot and performs necessary initialization.
 * @async
 * @function startBot
 * @throws {Error} If bot startup fails
 */
async function startBot() {
  try {
    if (config.settings.deployCommandsOnStart) {
      logger.info('Deploying commands before bot start...');
      await deployCommands();
      logger.info('Commands deployed successfully.');
    }

    await initializeDatabase();
    logger.info('Database initialized successfully.');

    await client.login(config.token);
  } catch (error) {
    logError('Error during bot startup', error);
    Sentry.captureException(error, {
      extra: { context: 'bot_startup_failure' }
    });
    process.exit(1);
  }
}

startBot();

process.on('uncaughtException', (error) => {
  logError('Uncaught Exception', error);
  Sentry.captureException(error, {
    extra: { context: 'uncaughtException' }
  });
  setTimeout(() => process.exit(1), SENTRY_FLUSH_TIMEOUT);
});

process.on('unhandledRejection', (reason, promise) => {
  logError('Unhandled Promise Rejection', reason);
  Sentry.captureException(reason, {
    extra: { context: 'unhandledRejection' }
  });
});

/**
 * Handles graceful shutdown of the bot.
 * @function handleShutdown
 * @param {string} signal - The shutdown signal received
 */
function handleShutdown(signal) {
  logger.info(`Shutdown signal (${signal}) received. We're cleaning up and exiting...`);
  Sentry.close(SENTRY_FLUSH_TIMEOUT).then(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));