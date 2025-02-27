const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev')
    .setDescription('Maintain developer tag.'),
  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      logger.warn(`Unauthorized /dev attempt by ${interaction.user.tag}`);
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }
    
    try {
      logger.debug(`/dev command received from ${interaction.user.tag}`);
      logger.debug("Developer tag maintenance completed.");
      await interaction.reply("🛠️ Developer tag maintained!");
    } catch (error) {
      logger.error(`Error in /dev command: ${error}`);
      await interaction.reply({ content: "⚠️ An error occurred while maintaining the developer tag. Please try again later.", ephemeral: true });
    }
  }
};
