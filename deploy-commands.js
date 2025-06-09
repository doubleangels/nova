/**
 * Module for deploying Discord slash commands.
 * @module deploy-commands
 */

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');
const { logError } = require('./errors');

/**
 * Error messages specific to command deployment.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while deploying commands.",
    MISSING_CLIENT_ID: "⚠️ Discord client ID is missing.",
    COMMAND_DEPLOYMENT_FAILED: "⚠️ Failed to deploy commands.",
    COMMAND_LOAD_FAILED: "⚠️ Failed to load command file.",
    INVALID_COMMAND: "⚠️ Invalid command structure.",
    API_ERROR: "⚠️ Discord API error occurred.",
    TOKEN_INVALID: "⚠️ Invalid bot token provided.",
    PERMISSION_DENIED: "⚠️ Insufficient permissions to deploy commands.",
    RATE_LIMIT_EXCEEDED: "⚠️ Discord API rate limit exceeded.",
    COMMAND_VALIDATION_FAILED: "⚠️ Command validation failed.",
    COMMAND_REGISTRATION_FAILED: "⚠️ Failed to register command with Discord."
};

/**
 * Deploys all slash commands to Discord.
 * Reads command files from the commands directory and registers them with Discord's API.
 * @async
 * @function deployCommands
 * @throws {Error} If command deployment fails
 * @returns {Promise<void>}
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

module.exports = deployCommands;

if (require.main === module) {
  deployCommands()
    .then(() => logger.info('Command deployment completed successfully.'))
    .catch(error => {
      logError('Failed to deploy commands', error);
      process.exit(1);
    });
}