const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { query } = require('../utils/database');
const { scheduleReminder } = require('../utils/reminderUtils');

// These are the configuration constants for the Disboard bump reminder.
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
      const existingReminder = await this.checkExistingReminder(interaction.channelId);
      
      // We generate the scheduled time for the reminder.
      const scheduledTime = dayjs().add(DELAY_SECONDS, 'second').toDate();
      const readableTime = dayjs(scheduledTime).format('YYYY-MM-DD HH:mm:ss');
      
      // We schedule the reminder using reminderUtils.
      const reminderId = await scheduleReminder(interaction.client, interaction.channelId, scheduledTime);
      
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
        scheduledTime: scheduledTime.toISOString()
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
   * @param {string} channelId - The channel ID to check for existing reminders.
   * @returns {Promise<boolean>} True if a reminder exists, false otherwise.
   */
  async checkExistingReminder(channelId) {
    try {
      const result = await query(`
        SELECT id 
        FROM main.recovery 
        WHERE channel_id = $1 
        AND type = 'reminder' 
        AND status = 'pending'
      `, [channelId]);
      
      return result.rows.length > 0;
    } catch (error) {
      logger.warn("Error checking for existing reminder.", { 
        error: error.message,
        channelId
      });
      return false;
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
