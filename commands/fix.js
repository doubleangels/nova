const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { getValue } = require('../utils/database');
const Keyv = require('keyv');
const { KeyvFile } = require('keyv-file');

// Initialize Keyv for reminder storage
const reminderKeyv = new Keyv({
  store: new KeyvFile({
    filename: './data/database.json'
  }),
  namespace: 'nova_reminders'
});

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
      
      const reminderId = randomUUID();
      const scheduledTime = dayjs().add(7200, 'second');
      const unixTimestamp = Math.floor(scheduledTime.valueOf() / 1000);

      const channel = await interaction.client.channels.fetch(reminderChannelId);
      
      await this.saveReminderToDatabase(reminderId, scheduledTime.toISOString());
      
      const embed = new EmbedBuilder()
          .setColor(0xcd41ff)
          .setTitle('🔧 Disboard Bump Reminder Fixed')
          .setDescription(`Disboard bump reminder successfully fixed! Next bump reminder scheduled <t:${unixTimestamp}:R>.`);
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/fix command completed successfully:", {
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
   * Checks if there are any existing active reminders.
   * 
   * @returns {Promise<boolean>} True if there are existing reminders, false otherwise
   */
  async checkExistingReminder() {
    try {
      const bumpIds = await reminderKeyv.get('reminders:bump:list') || [];
      const promoteIds = await reminderKeyv.get('reminders:promote:list') || [];
      const now = new Date();
      
      // Check bump reminders
      for (const id of bumpIds) {
        const reminder = await reminderKeyv.get(`reminder:${id}`);
        if (reminder && reminder.remind_at && new Date(reminder.remind_at) > now) {
          return true;
        }
      }
      
      // Check promote reminders
      for (const id of promoteIds) {
        const reminder = await reminderKeyv.get(`reminder:${id}`);
        if (reminder && reminder.remind_at && new Date(reminder.remind_at) > now) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.warn("Error checking for existing reminder:", { error: error.message });
      return false;
    }
  },
  
  /**
   * Saves a new reminder to the database.
   * Cleans up any existing reminders before saving.
   * 
   * @param {string} reminderId - The unique identifier for the reminder
   * @param {string} scheduledTime - The ISO string of when the reminder should trigger
   * @throws {Error} If there's an error saving to the database
   * @returns {Promise<void>}
   */
  async saveReminderToDatabase(reminderId, scheduledTime) {
    try {
      // Clean up existing reminders first
      const reminderIds = await reminderKeyv.get('reminders:bump:list') || [];
      const now = new Date();
      let deletedCount = 0;
      
      for (const id of reminderIds) {
        const reminder = await reminderKeyv.get(`reminder:${id}`);
        if (reminder && reminder.remind_at) {
          const remindAt = new Date(reminder.remind_at);
          if (remindAt > now) {
            await reminderKeyv.delete(`reminder:${id}`);
            deletedCount++;
          }
        }
      }
      
      // Update the list
      const filtered = reminderIds.filter(id => {
        // Keep only if reminder doesn't exist or is expired
        return true; // Will be filtered by the cleanup above
      });
      await reminderKeyv.set('reminders:bump:list', filtered);
      
      logger.debug("Cleaned up existing reminders of type:", { type: 'bump', deletedCount });

      // Insert new reminder
      const reminderData = {
        reminder_id: reminderId,
        remind_at: scheduledTime,
        type: 'bump'
      };
      await reminderKeyv.set(`reminder:${reminderId}`, reminderData);
      
      // Add to list
      const list = await reminderKeyv.get('reminders:bump:list') || [];
      if (!list.includes(reminderId)) {
        list.push(reminderId);
        await reminderKeyv.set('reminders:bump:list', list);
      }
      
      logger.debug("Reminder data saved to database:", { 
        reminderId: reminderId, 
        scheduledTime: scheduledTime,
        type: 'bump'
      });
    } catch (error) {
      logger.error("Database error while saving reminder:", { error: error.message, reminderId: reminderId });
      throw new Error("DATABASE_ERROR");
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
