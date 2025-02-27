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

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    // For guild commands (updates instantly)
    const guildId = '1307236666989346837'; // Replace with your guild ID
    const clientId = '1343753891338129520'; // Replace with your bot's application client ID

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    
    console.log('Successfully reloaded application (/) commands for the guild.');
    
    // If you prefer to register globally, use:
    // await rest.put(
    //   Routes.applicationCommands(clientId),
    //   { body: commands }
    // );
    // console.log('Successfully reloaded global application (/) commands.');
    
  } catch (error) {
    console.error(error);
  }
})();