const { Client, Collection, GatewayIntentBits } = require('discord.js');
const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');

// Initialize Sentry with performance monitoring.
Sentry.init({
  dsn: "https://11b0fbce04a61c3cf602b4c2ab444c83@o244019.ingest.us.sentry.io/4508695162060800",
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

/**
 * Create a new Discord client instance with the necessary intents.
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // Access to guild data.
    GatewayIntentBits.GuildMessages,    // Receive messages from guilds.
    GatewayIntentBits.MessageContent,   // Read message content.
    GatewayIntentBits.GuildMembers,     // Access member data.
  ]
});

// Create a collection to store bot commands.
client.commands = new Collection();

// Load command files from the 'commands' directory.
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
  logger.info(`Loaded command: ${command.data.name}`);
}

// Load event files from the 'events' directory.
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  // Bind the event, using 'once' if specified.
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
  logger.info(`Loaded event: ${event.name}`);
}

// Log when the bot is ready and online.
client.once('ready', async () => {
  logger.info(`Bot is online as ${client.user.tag}`);
});

// Listen for interaction events (slash commands).
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}:`, error);
    // Reply with an error message if the command fails.
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error executing that command!', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error executing that command!', ephemeral: true });
    }
  }
});

// Log the client in using the token from the config.
client.login(config.token).catch(err => {
  logger.error('Error logging in:', err);
});

// Gracefully handle process termination signals.
process.on('SIGINT', () => {
  logger.info("Shutdown signal received. Exiting...");
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info("Shutdown signal received. Exiting...");
  process.exit(0);
});
