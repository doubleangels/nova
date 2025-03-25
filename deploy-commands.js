const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path'); // Move this up
const logger = require('./logger')(path.basename(__filename)); // Now path is available
const config = require('./config');

/**
 * Deploys all slash commands to Discord API
 * This function collects all command modules from the commands directory,
 * converts them to the format required by Discord, and registers them globally
 * for the application.
 * 
 * @returns {Promise<void>} A promise that resolves when commands are successfully registered
 * @throws {Error} If command registration fails
 */
async function deployCommands() {
  // Array to store command data
  const commands = [];
  
  // Path to the commands directory
  const commandsPath = path.join(__dirname, 'commands');
  
  // Get all JavaScript files from the commands directory
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  
  // Load each command and add its data to the commands array
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
    logger.debug(`Loaded command: ${file}`);
  }
  
  // Create REST instance for Discord API interaction
  const rest = new REST({ version: '10' }).setToken(config.token);
  
  // Get client ID from environment variables or config
  const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
  logger.info(`Deploying commands for application ID: ${clientId}`);
  
  try {    
    // Register all commands globally for the application
    await rest.put(
      Routes.applicationCommands(clientId), 
      { body: commands }
    );
    
    logger.info(`Successfully registered ${commands.length} application (/) commands.`);
  } catch (error) {
    logger.error('Failed to deploy commands:', { error });
    throw error; // Re-throw for handling by caller
  }
}

// Export function for importing in other files
module.exports = deployCommands;

// If this script is run directly, execute the deployment
if (require.main === module) {
  deployCommands()
    .then(() => logger.info('Command deployment completed successfully'))
    .catch(err => {
      logger.error('Failed to deploy commands:', err);
      process.exit(1);
    });
}