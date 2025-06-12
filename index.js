const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');

const COMMANDS_DIRECTORY = 'commands';
const EVENTS_DIRECTORY = 'events';
const FILE_EXTENSION = '.js';

const BOT_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.GuildMessageReactions,
];

const ERROR_MESSAGE_COMMAND = 'There was an error executing that command!';
const ERROR_MESSAGE_CONTEXT_MENU = 'There was an error executing that command!';

const PROCESS_EXIT_DELAY = 1000;

const client = new Client({
  intents: BOT_INTENTS
});

client.commands = new Collection();
client.conversationHistory = new Map();

const deployCommands = require('./deploy-commands');
deployCommands().then(() => logger.info('Slash commands deployed on startup.')).catch(err => logger.error('Failed to deploy slash commands on startup:', err));

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

client.login(config.token);

process.on('SIGINT', () => {
  logger.info('Shutdown signal (SIGINT) received. Exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutdown signal (SIGTERM) received. Exiting...');
  process.exit(0);
});