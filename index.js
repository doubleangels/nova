const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');
const Sentry = require('./sentry');

// Configuration constants.
const COMMAND_EXTENSION = '.js';
const SENTRY_FLUSH_TIMEOUT = 2000;

/**
 * This script initializes and configures a Discord bot using discord.js.
 * It loads commands and event handlers and handles bot interactions, 
 * including slash commands and context menu commands.
 */

// Create a new Discord client instance with necessary gateway intents.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // Allows bot to access basic guild (server) data.
    GatewayIntentBits.GuildMessages,    // Allows bot to read messages in guilds.
    GatewayIntentBits.MessageContent,   // Allows bot to read the content of messages.
    GatewayIntentBits.GuildMembers,     // Allows bot to access guild member information.
    GatewayIntentBits.GuildPresences,   // Allows bot to track member presence (online/offline).
    GatewayIntentBits.GuildMessageReactions, // Allows bot to receive reaction events.
  ],
  partials: [
    Partials.Message,    // Allows bot to handle reactions on uncached messages.
    Partials.Channel,    // Allows bot to handle messages in uncached channels.
    Partials.Reaction    // Allows bot to handle uncached reactions.
  ]
});

// Collection to store bot commands.
client.commands = new Collection();

// Load and register command files.
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(COMMAND_EXTENSION));

// Get the list of disabled commands if available.
const disabledCommands = config.settings?.disabledCommands || [];
const hasDisabledCommands = Array.isArray(disabledCommands) && disabledCommands.length > 0;

if (hasDisabledCommands) {
  logger.info(`Using disabledCommands filter - will not load ${disabledCommands.length} specified commands.`);
}

let loadedCount = 0;
let skippedCount = 0;

// Process each command file.
for (const file of commandFiles) {
  const commandName = file.replace(COMMAND_EXTENSION, ''); 
  
  // Skip this command if it's in the disabled list.
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

// Log summary of loaded commands.
logger.info(`Command loading complete: ${loadedCount} loaded, ${skippedCount} skipped.`);

// Load and register event files.
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(COMMAND_EXTENSION));

// Process each event file.
for (const file of eventFiles) {
  try {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    
    if (event.once) {
      client.once(event.name, (...args) => {
        logger.debug("Executing once event:", { event: event.name });
        event.execute(...args, client);
      });
    } else {
      client.on(event.name, (...args) => {
        // Only log debug for non-frequent events to avoid log spam.
        if (event.name !== 'typingStart' && event.name !== 'presenceUpdate') {
          logger.debug("Executing event:", { event: event.name });
        }
        event.execute(...args, client);
      });
    }
    logger.info("Loaded event:", { event: event.name });
  } catch (error) {
    logger.error(`Failed to load event from ${file}:`, { error });
    Sentry.captureException(error, {
      extra: { context: 'event_loading_failure', eventFile: file }
    });
  }
}

// Event triggered when the bot is ready.
client.once('ready', async () => {
  logger.info("Bot is online:", { tag: client.user.tag });
});

// Log the bot in using the token from the config file.
client.login(config.token).catch(err => {
  Sentry.captureException(err, {
    extra: { context: 'bot_login_failure' }
  });
  logger.error("Error logging in:", { error: err });
});

// Add global unhandled error handlers.
process.on('uncaughtException', (error) => {
  Sentry.captureException(error, {
    extra: { context: 'uncaughtException' }
  });
  logger.error('Uncaught Exception:', { error });
  // Don't exit immediately to allow Sentry to send the error.
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
 * @param {string} signal - The signal that triggered the shutdown.
 */
function handleShutdown(signal) {
  logger.info(`Shutdown signal (${signal}) received. Exiting...`);
  // Flush Sentry events before exiting.
  Sentry.close(SENTRY_FLUSH_TIMEOUT).then(() => {
    process.exit(0);
  });
}

// Gracefully handle termination signals (for clean bot shutdown).
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
