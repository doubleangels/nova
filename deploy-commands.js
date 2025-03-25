const { REST, Routes } = require('discord.js');
const fs = require('fs');
const logger = require('./logger')(path.basename(__filename));
const path = require('path');
const config = require('./config');

/**
 * Deploys all commands to Discord
 * @returns {Promise<void>}
 */
async function deployCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
  }

  const rest = new REST({ version: '10' }).setToken(config.token);

  // Access DISCORD_CLIENT_ID from process.env or config
  const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
  logger.info(`Client ID: ${clientId}`);

  try {    
    // Use the clientId variable here
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    
    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
    throw error; // Re-throw so the calling function can handle it
  }
}

// Export the function so it can be imported elsewhere
module.exports = deployCommands;

// If this script is run directly (node deploy-commands.js), execute the deployment
if (require.main === module) {
  deployCommands()
    .then(() => console.log('Command deployment completed'))
    .catch(err => {
      console.error('Failed to deploy commands:', err);
      process.exit(1);
    });
}
