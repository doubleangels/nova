const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { setReminderData } = require('../utils/supabase');
const logger = require('../logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetreminders')
    .setDescription('Reset the Disboard reminder in the database to its default value.'),
  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      logger.warn(`Unauthorized /resetreminders attempt by ${interaction.user.tag}`);
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }
    
    try {
      logger.debug(`/resetreminders command received from ${interaction.user.tag}`);
      await interaction.deferReply();

      await setReminderData("disboard", null, null);
      logger.debug("Reset reminder data for disboard");

      logger.debug("Disboard reminder successfully reset.");
      await interaction.editReply("✅ The Disboard reminder has been reset to default values.");
    } catch (error) {
      logger.error(`Error in /resetreminders command: ${error}`);
      await interaction.editReply("⚠️ An error occurred while resetting the Disboard reminder. Please try again later.");
    }
  }
};
