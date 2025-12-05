const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');

/**
 * Command module for fixing Disboard bump reminder data.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Fix Disboard bump reminder data in the database.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the fix command.
   * This function:
   * 1. Validates reminder configuration
   * 2. Creates a new reminder entry
   * 3. Saves the reminder to the database
   * 4. Sends a confirmation embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error fixing the reminder data
   * @returns {Promise<void>}
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
        await interaction.editReply("⚠️ Reminder configuration is incomplete. Please use `/reminder setup` to configure the reminder channel and role first.");
        return;
      }
      
      const scheduledTime = dayjs().add(7200, 'second');
      const unixTimestamp = Math.floor(scheduledTime.valueOf() / 1000);

      // Use handleReminder from reminderUtils to properly save the reminder
      // This ensures consistency with how reminders are created elsewhere
      // Skip confirmation message since we send our own embed
      const mockMessage = { client: interaction.client };
      const delayMs = scheduledTime.diff(dayjs(), 'millisecond');
      
      await handleReminder(mockMessage, delayMs, 'bump', true);
      
      logger.info("Reminder saved via handleReminder:", {
        delayMs,
        scheduledTime: scheduledTime.toISOString()
      });
      
      const embed = new EmbedBuilder()
          .setColor(0xcd41ff)
          .setTitle('🔧 Disboard Bump Reminder Fixed')
          .setDescription(`Disboard bump reminder successfully fixed! Next bump reminder scheduled <t:${unixTimestamp}:R>.`);
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/fix command completed successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        scheduledTime: scheduledTime.toISOString()
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  
  /**
   * Handles errors that occur during command execution.
   * Logs the error and sends an appropriate error message to the user.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in fix command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while fixing the reminder.";
    
    if (error.message === "DATABASE_ERROR") {
      errorMessage = "⚠️ Failed to save reminder data to the database. Please try again later.";
    } else if (error.message === "CHANNEL_NOT_FOUND") {
      errorMessage = "⚠️ The reminder channel could not be found.";
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
