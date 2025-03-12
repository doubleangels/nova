const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(config.token);

// Access DISCORD_CLIENT_ID directly from process.env
const clientId = process.env.DISCORD_CLIENT_ID;
console.log(`Client ID: ${clientId}`);

(async () => {
  try {    
    // Use the clientId variable here
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    
    console.log('Successfully reloaded guild application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();