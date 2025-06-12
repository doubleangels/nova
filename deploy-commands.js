const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')(path.basename(__filename));
const config = require('./config');

/**
 * Deploys slash commands to Discord's API
 * This function:
 * 1. Loads all command files from the commands directory
 * 2. Registers them with Discord's API
 * 3. Updates existing commands if they've changed
 * 
 * @returns {Promise<void>}
 * @throws {Error} If command deployment fails
 */
async function deployCommands() {
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