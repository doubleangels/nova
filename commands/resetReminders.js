const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setReminderData } = require('../utils/supabase');

/**
 * Module for the /resetreminders command.
 * Resets the Disboard reminder in the database to its default values.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetreminders')
    .setDescription('Reset the Disboard reminder in the database to its default value.'),
    
  /**
   * Executes the /resetreminders command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    // Check for Administrator permissions.
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      logger.warn("Unauthorized /resetreminders attempt:", { user: interaction.user.tag });
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }
    
    try {
      logger.debug("/resetreminders command received", { user: interaction.user.tag });
      
      // Defer the reply to allow processing time.
      await interaction.deferReply();
      
      // Reset the reminder data for 'disboard' to default values (null).
      await setReminderData("disboard", null, null);
      logger.debug("Reset reminder data.");
      
      // Inform the user that the reminder has been reset.
      await interaction.editReply("✅ The Disboard reminder has been reset to default values.");
      logger.debug("Disboard reminder successfully reset:", { user: interaction.user.tag });
    } catch (error) {
      logger.error("Error in /resetreminders command:", { error });
      await interaction.editReply("⚠️ An error occurred while resetting the Disboard reminder. Please try again later.");
    }
  }
};
