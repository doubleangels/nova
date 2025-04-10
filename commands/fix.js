const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { setReminderData } = require('../utils/database');

// Configuration constants.
const REMINDER_CONSTANTS = {
  SERVICE_TYPE: 'bump',
  DELAY_SECONDS: 7200,  // 2 hours in seconds
};

/**
 * Module for the /fix command.
 * This command runs the fix logic for Disboard by adding the service data to the database.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Fix reminder data in the database.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the /fix command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Log the command initiation with the user's ID for better tracking.
      logger.info("Fix command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
      
      // Defer the reply to allow processing time.
      await interaction.deferReply();

      // Generate unique reminder data.
      const reminderId = randomUUID();
      const scheduledTime = dayjs().add(REMINDER_CONSTANTS.DELAY_SECONDS, 'second').toISOString();
      
      // Save the reminder data to the database.
      await setReminderData(
        REMINDER_CONSTANTS.SERVICE_TYPE, 
        scheduledTime, 
        reminderId
      );
      
      logger.debug("Reminder data saved to database.", { 
        reminderId: reminderId,
        scheduledTime: scheduledTime,
        serviceType: REMINDER_CONSTANTS.SERVICE_TYPE
      });
      
      // Inform the user that the fix logic was successfully applied.
      await interaction.editReply("✅ Reminder successfully fixed!");
      
      logger.info("Fix command completed successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        reminderId: reminderId
      });
    } catch (error) {
      logger.error("Error in /fix command.", { 
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
      
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later.",
        ephemeral: true
      });
    }
  }
};
