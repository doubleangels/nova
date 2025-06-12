const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');

const COMMANDS_DIRECTORY = 'commands';
const COMMAND_FILE_EXTENSION = '.js';
const DISCORD_API_VERSION = '10';

async function deployCommands() {
  const commands = [];
  
  const commandsPath = path.join(__dirname, COMMANDS_DIRECTORY);
  
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(COMMAND_FILE_EXTENSION));
  
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
    logger.debug(`Loaded command: ${file}`);
  }
  
  const rest = new REST({ version: DISCORD_API_VERSION }).setToken(config.token);
  
  const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
  logger.info(`Deploying commands for application ID: ${clientId}`);
  
  try {    
    await rest.put(
      Routes.applicationCommands(clientId), 
      { body: commands }
    );
    
    logger.info(`Successfully registered ${commands.length} application (/) commands.`);
  } catch (error) {
    logger.error('Failed to deploy commands:', { error });
    throw error;
  }
}

module.exports = deployCommands;

if (require.main === module) {
  deployCommands()
    .then(() => logger.info('Command deployment completed successfully.'))
    .catch(err => {
      logger.error('Failed to deploy commands:', err);
      process.exit(1);
    });
}