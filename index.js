/**
 * Main entry point for the Discord bot.
 * Initializes the bot, loads commands and events, and handles startup/shutdown.
 * @module index
 */

const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');

/** Directory containing command files */
const COMMANDS_DIRECTORY = 'commands';
/** Directory containing event handler files */
const EVENTS_DIRECTORY = 'events';
/** File extension for command and event files */
const FILE_EXTENSION = '.js';

/**
 * Bot's required Discord gateway intents
 * @type {Array<number>}
 */
const BOT_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

// Error message constants
const ERROR_MESSAGE_COMMAND = 'There was an error executing that command!';
const ERROR_MESSAGE_CONTEXT_MENU = 'There was an error executing that command!';

/** Delay in milliseconds before forced process exit */
const PROCESS_EXIT_DELAY = 1000;

/**
 * Discord client instance with required intents
 * @type {Client}
 */
const client = new Client({
  intents: BOT_INTENTS
});

// Initialize collections for commands and conversation history
client.commands = new Collection();
client.conversationHistory = new Map();

// Load command files
const commandsPath = path.join(__dirname, COMMANDS_DIRECTORY);
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(FILE_EXTENSION));

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
    logger.info(`Loaded command: ${command.data.name}`);
  } catch (error) {
    logger.error(`Error loading command file: ${file}`, {
      error: error.stack,
      message: error.message
    });
  }
}

// Load event files
const eventsPath = path.join(__dirname, EVENTS_DIRECTORY);
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(FILE_EXTENSION));

for (const file of eventFiles) {
  try {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
    logger.info(`Loaded event: ${event.name}`);
  } catch (error) {
    logger.error(`Error loading event file: ${file}`, {
      error: error.stack,
      message: error.message
    });
  }
}

// Login to Discord
client.login(config.token);

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Shutdown signal (SIGINT) received. Exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutdown signal (SIGTERM) received. Exiting...');
  process.exit(0);
});