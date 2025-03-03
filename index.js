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
logger.info("Sentry initialized with performance monitoring.");

/**
 * Create a new Discord client instance with the necessary intents.
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // Access to guild data.
    GatewayIntentBits.GuildMessages,    // Receive messages from guilds.
    GatewayIntentBits.MessageContent,   // Read message content.
    GatewayIntentBits.GuildMembers,     // Access member data.
    GatewayIntentBits.GuildPresences,   // Access member presence data.
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
  logger.info("Loaded command:", { command: command.data.name });
}

// Load event files from the 'events' directory.
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

// Log when the bot is ready and online.
client.once('ready', async () => {
  logger.info("Bot is online:", { tag: client.user.tag });
});

// Listen for interaction events (slash commands).
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    logger.debug("Executing command:", { command: interaction.commandName, user: interaction.user.tag });
    await command.execute(interaction);
  } catch (error) {
    logger.error("Error executing command:", { command: interaction.commandName, error });
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error executing that command!', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error executing that command!', ephemeral: true });
    }
  }
});

// Listen for context menu interaction events.
// Add this to your index.js file, right after the existing interactionCreate event handler

// Listen for context menu command interactions
client.on('interactionCreate', async interaction => {
  // Skip if it's not a context menu command
  if (!interaction.isContextMenuCommand()) return;

  logger.debug("Executing context menu command:", { 
    command: interaction.commandName, 
    user: interaction.user.tag 
  });

  const command = client.commands.get(interaction.commandName);
  
  if (!command) {
    logger.warn("Unknown context menu command:", { command: interaction.commandName });
    return;
  }
  
  try {
    await command.execute(interaction);
    logger.debug("Context menu command executed successfully:", { command: interaction.commandName });
  } catch (error) {
    logger.error("Error executing context menu command:", { 
      command: interaction.commandName, 
      error 
    });
    
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ 
          content: 'There was an error executing that command!', 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: 'There was an error executing that command!', 
          ephemeral: true 
        });
      }
    } catch (replyError) {
      logger.error("Error sending error response:", { error: replyError });
    }
  }
});

// Log the client in using the token from the config.
client.login(config.token).catch(err => {
  logger.error("Error logging in:", { err });
});

// Gracefully handle process termination signals.
process.on('SIGINT', () => {
  logger.info("Shutdown signal (SIGINT) received. Exiting...");
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info("Shutdown signal (SIGTERM) received. Exiting...");
  process.exit(0);
});
