const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * This script refreshes (registers) the application's slash commands for a specific guild.
 * It reads command files from the 'commands' directory, converts them to JSON,
 * and deploys them using Discord's REST API.
 */

// Array to hold command data in JSON format.
const commands = [];
// Path to the commands directory.
const commandsPath = path.join(__dirname, 'commands');
// Read all .js files in the commands directory.
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Iterate over each command file, require it, and add its JSON data to the commands array.
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.push(command.data.toJSON());
}

// Initialize a new REST client with Discord API version 10 and set the bot token.
const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    
    // Define the target guild ID and the client (application) ID.
    const devGuildId = '1307236666989346837';
    const productionGuildId = '691991366615564388';
    const clientId = '1343753891338129520';

    // Register (or update) the commands for the specified guilds.
    await rest.put(
      Routes.applicationGuildCommands(clientId, devGuildId),
      { body: commands }
    );

    //await rest.put(
    //  Routes.applicationGuildCommands(clientId, productionGuildId),
    //  { body: commands }
    //);
    
    console.log('Successfully reloaded application (/) commands for the guild.');
  } catch (error) {
    // Log any errors that occur during the command refresh process.
    console.error(error);
  }
})();
