const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config'); // Contains your bot token and other config values
const logger = require('./logger'); // Your logging module

// Create a new Discord client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

// (Optional) Load commands if needed
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
  logger.info(`Loaded command: ${command.data.name}`);
}

// Load events from the "events" folder
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
  logger.info(`Loaded event: ${event.name}`);
}

// When the bot is ready, log the event and test Supabase connectivity
client.once('ready', async () => {
  logger.info(`Bot is online as ${client.user.tag}`);
});

// Handle interactions for slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error executing that command!', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error executing that command!', ephemeral: true });
    }
  }
});

// Log in to Discord
client.login(config.token).catch(err => {
  logger.error('Error logging in:', err);
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info("Shutdown signal received. Exiting...");
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info("Shutdown signal received. Exiting...");
  process.exit(0);
});
