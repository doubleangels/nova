const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

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
    console.log('Started refreshing global application (/) commands.');
    
    // Define the client (application) ID.
    const clientId = '1343753891338129520';

    // Register (or update) the commands globally.
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    
    console.log('Successfully reloaded global application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
