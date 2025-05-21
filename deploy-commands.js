const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');
const { logError, ERROR_MESSAGES } = require('./errors');

/**
 * We deploy all slash commands to Discord API.
 * 
 * We collect all command modules from the commands directory,
 * convert them to the format required by Discord, and register them globally
 * for the application. This ensures our bot's commands are available to users.
 * 
 * @returns {Promise<void>} A promise that resolves when commands are successfully registered.
 * @throws {Error} If command registration fails.
 */
async function deployCommands() {
  try {
    const commands = [];
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
      const command = require(`./commands/${file}`);
      commands.push(command.data.toJSON());
      logger.debug(`Loaded command: ${file}`);
    }
    
    const rest = new REST({ version: '10' }).setToken(config.token);
    const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
    
    if (!clientId) {
      throw new Error(ERROR_MESSAGES.MISSING_CLIENT_ID);
    }
    
    logger.info(`Deploying commands for application ID: ${clientId}`);
    
    await rest.put(
      Routes.applicationCommands(clientId), 
      { body: commands }
    );
    
    logger.info(`Successfully registered ${commands.length} application (/) commands.`);
  } catch (error) {
    logError('Failed to deploy commands', error);
    throw new Error(ERROR_MESSAGES.COMMAND_DEPLOYMENT_FAILED);
  }
}

// We export the function for importing in other files.
module.exports = deployCommands;

// If this script is run directly, we execute the deployment.
if (require.main === module) {
  deployCommands()
    .then(() => logger.info('Command deployment completed successfully.'))
    .catch(error => {
      logError('Failed to deploy commands', error);
      process.exit(1); // We exit with error code if deployment fails.
    });
}