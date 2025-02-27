const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { setReminderData } = require('../utils/supabase');

/**
 * Module for the /fix command.
 * This command runs the fix logic for Disboard by adding the service data to the database.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Runs the fix logic for Disboard by adding the service data to the database.'),
    
  /**
   * Executes the /fix command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    // Check if the user has Administrator permissions.
    if (
      !interaction.memberPermissions.has("Administrator") &&
      !interaction.memberPermissions.has(require('discord.js').PermissionsBitField.Flags.Administrator)
    ) {
      logger.warn("Unauthorized /fix attempt:", { user: interaction.user.tag });
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }

    try {
      logger.debug("/fix command received:", { user: interaction.user.tag });
      
      // Defer the reply to allow processing time.
      await interaction.deferReply();

      // Define delay (in seconds) and generate unique reminder data.
      const seconds = 7200;
      const reminderId = randomUUID();
      // Use day.js to calculate the scheduled time.
      const scheduledTime = dayjs().add(seconds, 'second').toISOString();
      
      // Save the reminder data to the database.
      await setReminderData('bump', scheduledTime, reminderId);
      logger.debug("Fix applied:", { scheduledTime, reminderId });
      
      // Inform the user that the fix logic was successfully applied.
      await interaction.editReply("✅ Reminder successfully fixed!");
    } catch (error) {
      logger.error("Error in /fix command:", { error });
      await interaction.editReply("⚠️ An error occurred while applying fix. Please try again later.");
    }
  }
};
