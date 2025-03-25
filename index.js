const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');
const Sentry = require('./sentry');

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
  ]
});

// Collection to store bot commands.
client.commands = new Collection();

// Load and register command files.
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Check if we have a list of disabled commands
const hasDisabledCommandsList = config.settings && 
  config.settings.disabledCommands && 
  Array.isArray(config.settings.disabledCommands) && 
  config.settings.disabledCommands.length > 0;

if (hasDisabledCommandsList) {
  logger.info(`Using disabledCommands filter - will not load ${config.settings.disabledCommands.length} specified commands`);
}

let loadedCount = 0;
let skippedCount = 0;

for (const file of commandFiles) {
  const commandName = file.replace('.js', ''); // Get command name without extension
  
  // Skip this command if it's in the disabled list
  if (hasDisabledCommandsList && config.settings.disabledCommands.includes(commandName)) {
    logger.debug(`Skipping disabled command: ${commandName}`);
    skippedCount++;
    continue;
  }
  
  try {
    const command = require(path.join(commandsPath, file));
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

// Log summary of loaded commands
logger.info(`Command loading complete: ${loadedCount} loaded, ${skippedCount} skipped`);

// Load and register event files.
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => {
      logger.debug("Executing once event:", { event: event.name });
      event.execute(...args, client);
    });
  } else {
    client.on(event.name, (...args) => {
      logger.debug("Executing event:", { event: event.name });
      event.execute(...args, client);
    });
  }
  logger.info("Loaded event:", { event: event.name });
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
  logger.error("Error logging in:", { err });
});

// Add global unhandled error handlers
process.on('uncaughtException', (error) => {
  Sentry.captureException(error, {
    extra: { context: 'uncaughtException' }
  });
  logger.error('Uncaught Exception:', { error });
  // Don't exit immediately to allow Sentry to send the error
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  Sentry.captureException(reason, {
    extra: { context: 'unhandledRejection' }
  });
  logger.error('Unhandled Promise Rejection:', { reason });
});

// Gracefully handle termination signals (for clean bot shutdown).
process.on('SIGINT', () => {
  logger.info("Shutdown signal (SIGINT) received. Exiting...");
  // Flush Sentry events before exiting
  Sentry.close(2000).then(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logger.info("Shutdown signal (SIGTERM) received. Exiting...");
  // Flush Sentry events before exiting
  Sentry.close(2000).then(() => {
    process.exit(0);
  });
});
