const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');

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

client.login(config.token);

/**
 * Handles graceful shutdown on SIGINT signal
 */
process.on('SIGINT', () => {
  logger.info('Shutdown signal (SIGINT) received. Exiting...');
  process.exit(0);
});

/**
 * Handles graceful shutdown on SIGTERM signal
 */
process.on('SIGTERM', () => {
  logger.info('Shutdown signal (SIGTERM) received. Exiting...');
  process.exit(0);
});