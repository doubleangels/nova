const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We set up a pool for direct SQL queries.
const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

// We define configuration constants for the Disboard bump reminder.
const SERVICE_TYPE = 'bump';
const DELAY_SECONDS = 7200;  // 2 hours in seconds

/**
 * We handle the fix command.
 * This function runs the fix logic for Disboard by adding the service data to the database.
 *
 * We perform several tasks:
 * 1. We check if there is already an active reminder in the database.
 * 2. We generate unique reminder data with a random UUID and scheduled time.
 * 3. We save the reminder data to the database.
 * 4. We inform the user of the result.
 *
 * Only users with Administrator permissions can execute this command.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Fix Disboard bump reminder data in the database.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * We execute the /fix command.
   * This function processes the fix request and updates the reminder data.
   *
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

      // We get the reminder channel ID.
      const reminderChannelId = await getValue('reminder_channel');
      if (!reminderChannelId) {
        await interaction.editReply(ERROR_MESSAGES.REMINDER_CONFIG_INCOMPLETE);
        return;
      }

      // We check if there's already an active reminder in the database.
      const existingReminder = await this.checkExistingReminder();
      
      // We generate unique reminder data with a random UUID and scheduled time.
      const reminderId = randomUUID();
      const scheduledTime = dayjs().add(DELAY_SECONDS, 'second');
      const unixTimestamp = Math.floor(scheduledTime.valueOf() / 1000);

      // We get the channel and send a message.
      const channel = await interaction.client.channels.fetch(reminderChannelId);
      const sentMsg = await channel.send(`⏰ Next bump reminder scheduled for: <t:${unixTimestamp}:R>`);
      
      // We save the reminder data to the database for future processing.
      await this.saveReminderToDatabase(reminderId, scheduledTime.toISOString());
      
      // We prepare the response message with details about the scheduled reminder.
      let responseMessage = "✅ Disboard bump reminder successfully fixed!\n";
      responseMessage += `⏰ Next bump reminder scheduled <t:${unixTimestamp}:R>.`;
      
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
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * We check if there's an existing reminder in the database.
   * This function queries the database for active reminders.
   *
   * @returns {Promise<boolean>} True if a reminder exists, false otherwise.
   */
  async checkExistingReminder() {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) FROM main.reminder_recovery WHERE remind_at > NOW()`
      );
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      logger.warn("Error checking for existing reminder.", { error: error.message });
      return false;
    }
  },
  
  /**
   * We save the reminder data to the database for future processing.
   * This function inserts the reminder information into the database.
   *
   * @param {string} reminderId - The unique ID for the reminder.
   * @param {string} scheduledTime - The ISO string of the scheduled time.
   * @returns {Promise<void>}
   */
  async saveReminderToDatabase(reminderId, scheduledTime) {
    try {
      await pool.query(
        `INSERT INTO main.reminder_recovery (reminder_id, remind_at) VALUES ($1, $2)`,
        [reminderId, scheduledTime]
      );
      logger.debug("Reminder data saved to database.", { reminderId: reminderId, scheduledTime: scheduledTime });
    } catch (error) {
      logger.error("Database error while saving reminder.", { error: error.message, reminderId: reminderId });
      throw new Error("DATABASE_ERROR");
    }
  },
  
  /**
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'fix', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "DATABASE_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_WRITE_ERROR;
    } else if (error.message === "CHANNEL_NOT_FOUND") {
      errorMessage = ERROR_MESSAGES.REMINDER_INVALID_CHANNEL;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for fix command.", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // We silently catch if all error handling attempts fail.
      });
    }
  }
};
