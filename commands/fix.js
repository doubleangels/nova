const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { setReminderData, getReminderData } = require('../utils/database');

// These are the configuration constants for the Disboard bump reminder.
const SERVICE_TYPE = 'bump';
const DELAY_SECONDS = 7200;  // 2 hours in seconds

/**
 * Module for the /fix command.
 * This command runs the fix logic for Disboard by adding the service data to the database.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Fix Disboard bump reminder data in the database.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the /fix command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // We log the command initiation with the user's ID for better tracking in our system.
      logger.info("Fix command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
      
      // We defer the reply to allow processing time for database operations.
      await interaction.deferReply();

      // We check if there's already an active reminder in the database.
      const existingReminder = await this.checkExistingReminder();
      // We generate unique reminder data with a random UUID and scheduled time.
      const reminderId = randomUUID();
      const scheduledTime = dayjs().add(DELAY_SECONDS, 'second').toISOString();
      const readableTime = dayjs(scheduledTime).format('YYYY-MM-DD HH:mm:ss');
      
      // We save the reminder data to the database for future processing.
      await this.saveReminderToDatabase(reminderId, scheduledTime);
      
      // We prepare the response message with details about the scheduled reminder.
      let responseMessage = "✅ Disboard bump reminder successfully fixed!\n";
      responseMessage += `⏰ Next bump reminder scheduled for: **${readableTime}**`;
      
      if (existingReminder) {
        responseMessage += "\n⚠️ Note: An existing reminder was overwritten.";
      }
      // We inform the user that the fix logic was successfully applied.
      await interaction.editReply(responseMessage);
      
      logger.info("Fix command completed successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        reminderId: reminderId,
        scheduledTime: scheduledTime
      });
    } catch (error) {
      logger.error("Error in /fix command.", { 
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
      
      await interaction.editReply({
        content: `⚠️ ${this.getErrorMessage(error)}`,
        ephemeral: true
      });
    }
  },
  
  /**
   * Checks if there's an existing reminder in the database.
   * @returns {Promise<boolean>} True if a reminder exists, false otherwise.
   */
  async checkExistingReminder() {
    try {
      const existingData = await getReminderData(SERVICE_TYPE);
      return !!existingData;
    } catch (error) {
      logger.warn("Error checking for existing reminder.", { 
        error: error.message,
        serviceType: SERVICE_TYPE
      });
      return false;
    }
  },
  
  /**
   * Saves the reminder data to the database for future processing.
   * @param {string} reminderId - The unique ID for the reminder.
   * @param {string} scheduledTime - The ISO string of the scheduled time.
   * @returns {Promise<void>}
   */
  async saveReminderToDatabase(reminderId, scheduledTime) {
    try {
      await setReminderData(SERVICE_TYPE, scheduledTime, reminderId);
      
      logger.debug("Reminder data saved to database.", { 
        reminderId: reminderId,
        scheduledTime: scheduledTime,
        serviceType: SERVICE_TYPE
      });
    } catch (error) {
      logger.error("Database error while saving reminder.", {
        error: error.message,
        reminderId: reminderId,
        serviceType: SERVICE_TYPE
      });
      throw new Error("DATABASE_ERROR");
    }
  },
  
  /**
   * Gets a user-friendly error message based on the error type.
   * @param {Error} error - The error object.
   * @returns {string} A user-friendly error message explaining the issue.
   */
  getErrorMessage(error) {
    if (error.message === "DATABASE_ERROR") {
      return "Failed to save reminder to database. Please check database connectivity and try again.";
    }
    return "An unexpected error occurred. Please try again later.";
  }
};
