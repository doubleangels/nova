const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');
const Sentry = require('./sentry');
const { initializeDatabase } = require('./utils/database');

// We define these configuration constants for consistent behavior throughout the application.
const COMMAND_EXTENSION = '.js';
const EVENT_EXTENSION = '.js';
const SENTRY_FLUSH_TIMEOUT = 2000;

/**
 * This script initializes and configures a Discord bot using discord.js.
 * We load commands and event handlers to manage bot interactions, 
 * including slash commands and context menu commands. This serves as the main
 * entry point for the bot application.
 */

// We create a new Discord client instance with necessary gateway intents.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // We need this to access basic guild (server) data.
    GatewayIntentBits.GuildMessages,    // We need this to read messages in guilds.
    GatewayIntentBits.MessageContent,   // We need this to read the content of messages.
    GatewayIntentBits.GuildMembers,     // We need this to access guild member information.
    GatewayIntentBits.GuildPresences,   // We need this to track member presence (online/offline).
    GatewayIntentBits.GuildMessageReactions, // We need this to receive reaction events.
    GatewayIntentBits.GuildVoiceStates, // Ensure this intent is included
  ],
  partials: [
    Partials.Message,    // We include this to handle reactions on uncached messages.
    Partials.Channel,    // We include this to handle messages in uncached channels.
    Partials.Reaction    // We include this to handle uncached reactions.
  ]
});

// We create a collection to store and easily access bot commands.
client.commands = new Collection();

// We load and register command files from the commands directory.
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(COMMAND_EXTENSION));

// We get the list of disabled commands if available from the configuration.
const disabledCommands = config.settings?.disabledCommands || [];
const hasDisabledCommands = Array.isArray(disabledCommands) && disabledCommands.length > 0;

if (hasDisabledCommands) {
  logger.info(`Using disabledCommands filter - we will not load ${disabledCommands.length} specified commands.`);
}

let loadedCount = 0;
let skippedCount = 0;

// We process each command file to register it with the bot.
for (const file of commandFiles) {
  const commandName = file.replace(COMMAND_EXTENSION, ''); 
  
  // We skip this command if it's in the disabled list.
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
    logger.error(`Failed to load command ${commandName}:`, { error });
    Sentry.captureException(error, {
      extra: { context: 'command_loading_failure', commandName }
    });
  }
}

// We log a summary of loaded commands for monitoring purposes.
logger.info(`Command loading complete: ${loadedCount} loaded, ${skippedCount} skipped.`);

// We load and register event files from the events directory.
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(EVENT_EXTENSION));

// We process each event file to register its handlers with the client.
for (const file of eventFiles) {
  try {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    
    if (!event.name || !event.execute) {
      throw new Error(`Event file ${file} is missing required properties (name or execute)`);
    }
    
    if (event.once) {
      client.once(event.name, (...args) => {
        logger.debug("Executing once event:", { event: event.name });
        event.execute(...args, client);
      });
    } else {
      client.on(event.name, (...args) => {
        // We only log debug for non-frequent events to avoid log spam.
        if (event.name !== 'typingStart' && event.name !== 'presenceUpdate') {
          logger.debug("Executing event:", { event: event.name });
        }
        event.execute(...args, client);
      });
    }
    logger.info("Loaded event:", { event: event.name });
  } catch (error) {
    logger.error(`Failed to load event from ${file}:`, { 
      error: error.message || error,
      stack: error.stack
    });
    Sentry.captureException(error, {
      extra: { 
        context: 'event_loading_failure', 
        eventFile: file,
        errorDetails: error.message || error
      }
    });
  }
}

// We set up an event triggered when the bot is ready to operate.
client.once('ready', async () => {
  try {
    await initializeDatabase();
    logger.info("Bot is online:", { tag: client.user.tag });
  } catch (error) {
    logger.error("Failed to initialize database:", { error });
    Sentry.captureException(error, {
      extra: { context: 'database_initialization_failure' }
    });
    // We exit if database initialization fails since it's critical
    process.exit(1);
  }
});

// We log the bot in using the token from the config file.
client.login(config.token).catch(err => {
  Sentry.captureException(err, {
    extra: { context: 'bot_login_failure' }
  });
  logger.error("Error logging in:", { error: err });
});

// We add global unhandled error handlers to prevent the bot from crashing silently.
process.on('uncaughtException', (error) => {
  Sentry.captureException(error, {
    extra: { context: 'uncaughtException' }
  });
  logger.error('Uncaught Exception:', { error });
  // We don't exit immediately to allow Sentry to send the error report.
  setTimeout(() => process.exit(1), SENTRY_FLUSH_TIMEOUT);
});

process.on('unhandledRejection', (reason, promise) => {
  Sentry.captureException(reason, {
    extra: { context: 'unhandledRejection' }
  });
  logger.error('Unhandled Promise Rejection:', { reason });
});

/**
 * Handles graceful shutdown when receiving termination signals.
 * We use this to ensure clean disconnection and resource cleanup.
 * 
 * @param {string} signal - The signal that triggered the shutdown.
 */
function handleShutdown(signal) {
  logger.info(`Shutdown signal (${signal}) received. We're cleaning up and exiting...`);
  // We flush Sentry events before exiting to ensure all error reports are sent.
  Sentry.close(SENTRY_FLUSH_TIMEOUT).then(() => {
    process.exit(0);
  });
}

// We gracefully handle termination signals for clean bot shutdown.
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));