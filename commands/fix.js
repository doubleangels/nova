/**
 * Fix command module for managing Disboard bump reminder data.
 * Handles database operations, reminder scheduling, and status updates.
 * @module commands/fix
 */

const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');
const { logError } = require('../errors');

const FIX_DB_TABLE = 'main.reminder_recovery';
const FIX_DB_TYPE = 'bump';

const FIX_EMBED_COLOR = '#cd41ff';
const FIX_EMBED_FOOTER_PREFIX = "Updated by";
const FIX_EMBED_TITLE = 'Disboard Bump Reminder Fixed';

const FIX_ERROR_CHANNEL_NOT_FOUND = "⚠️ The reminder channel could not be found.";
const FIX_ERROR_CONFIG_INCOMPLETE = "⚠️ Reminder configuration is incomplete. Please set up the reminder channel first.";
const FIX_ERROR_DATABASE = "⚠️ Failed to save reminder data to the database. Please try again later.";
const FIX_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while fixing the reminder.";

const FIX_DELAY_SECONDS = 7200;

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

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
   * Executes the fix command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If database operations fail
   */
  async execute(interaction) {
    try {
      logger.info("/fix command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
      
      await interaction.deferReply();

      const reminderChannelId = await getValue('reminder_channel');
      if (!reminderChannelId) {
        await interaction.editReply(FIX_ERROR_CONFIG_INCOMPLETE);
        return;
      }

      const existingReminder = await this.checkExistingReminder();
      
      const reminderId = randomUUID();
      const scheduledTime = dayjs().add(FIX_DELAY_SECONDS, 'second');
      const unixTimestamp = Math.floor(scheduledTime.valueOf() / 1000);

      const channel = await interaction.client.channels.fetch(reminderChannelId);
      const sentMsg = await channel.send(`⏰ Next bump reminder scheduled for: <t:${unixTimestamp}:R>`);
      
      await this.saveReminderToDatabase(reminderId, scheduledTime.toISOString());
      
      const embed = new EmbedBuilder()
          .setColor(FIX_EMBED_COLOR)
          .setTitle(FIX_EMBED_TITLE)
          .setDescription(`✅ Disboard bump reminder successfully fixed!\n⏰ Next bump reminder scheduled <t:${unixTimestamp}:R>.`)
          .setFooter({ text: `${FIX_EMBED_FOOTER_PREFIX} ${interaction.user.tag}` })
          .setTimestamp();
      
      if (existingReminder) {
          embed.addFields({ name: 'Note', value: '⚠️ An existing reminder was overwritten.' });
      }
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Fix command completed successfully:", {
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
   * Checks for existing reminders in the database.
   * @async
   * @function checkExistingReminder
   * @returns {Promise<boolean>} True if a reminder exists, false otherwise
   */
  async checkExistingReminder() {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) FROM main.reminder_recovery WHERE remind_at > NOW()`
      );
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      logger.warn("Error checking for existing reminder:", { error: error.message });
      return false;
    }
  },
  
  /**
   * Saves reminder data to the database.
   * @async
   * @function saveReminderToDatabase
   * @param {string} reminderId - The unique ID for the reminder
   * @param {string} scheduledTime - The ISO string of the scheduled time
   * @throws {Error} If database write fails
   */
  async saveReminderToDatabase(reminderId, scheduledTime) {
    try {
      // Clean up existing reminders first
      await pool.query(
        `DELETE FROM main.reminder_recovery WHERE remind_at > NOW() AND type = $1`,
        [FIX_DB_TYPE]
      );
      logger.debug("Cleaned up existing reminders of type:", FIX_DB_TYPE);

      await pool.query(
        `INSERT INTO main.reminder_recovery (reminder_id, remind_at, type) VALUES ($1, $2, $3)`,
        [reminderId, scheduledTime, FIX_DB_TYPE]
      );
      logger.debug("Reminder data saved to database:", { 
        reminderId: reminderId, 
        scheduledTime: scheduledTime,
        type: FIX_DB_TYPE 
      });
    } catch (error) {
      logger.error("Database error while saving reminder:", { error: error.message, reminderId: reminderId });
      throw new Error("DATABASE_ERROR");
    }
  },
  
  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'fix', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = FIX_ERROR_UNEXPECTED;
    
    if (error.message === "DATABASE_ERROR") {
      errorMessage = FIX_ERROR_DATABASE;
    } else if (error.message === "CHANNEL_NOT_FOUND") {
      errorMessage = FIX_ERROR_CHANNEL_NOT_FOUND;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for fix command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
      });
    }
  }
};
