const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const config = require('../config');
const { getValue } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');

/**
 * Command module for fixing reminder data.
 * Handles fixing reminders for Disboard, Discadia, and Reddit promotions.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Fix reminder data in the database.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('disboard')
        .setDescription('Fix Disboard bump reminder data in the database.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reddit')
        .setDescription('Fix Reddit promotion reminder data in the database.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('discadia')
        .setDescription('Fix Discadia bump reminder data in the database.')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the fix command.
   * This function:
   * 1. Defers the reply
   * 2. Processes the subcommand (disboard, reddit, or discadia)
   * 3. Handles any errors that occur
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error fixing the reminder data
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {
      logger.info("/fix command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand: interaction.options.getSubcommand()
      });
      
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'disboard') {
        await this.handleFixReminder(interaction, 'bump', 7200000, 'Disboard Bump');
      } else if (subcommand === 'reddit') {
        await this.handleFixReminder(interaction, 'promote', 86400000, 'Reddit Promotion');
      } else if (subcommand === 'discadia') {
        await this.handleFixReminder(interaction, 'discadia', 86400000, 'Discadia Bump');
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles fixing reminder data for a specific type.
   * This function:
   * 1. Validates reminder configuration
   * 2. Creates a new reminder entry
   * 3. Saves the reminder to the database
   * 4. Sends a confirmation embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {string} type - The type of reminder ('bump', 'discadia', or 'promote')
   * @param {number} delayMs - The delay in milliseconds before the reminder
   * @param {string} displayName - The display name for the reminder type
   * @throws {Error} If there's an error fixing the reminder data
   * @returns {Promise<void>}
   */
  async handleFixReminder(interaction, type, delayMs, displayName) {
    try {
      logger.info(`/fix ${type} command initiated:`, {
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });

      const reminderChannelId = await getValue('reminder_channel');
      if (!reminderChannelId) {
        await interaction.editReply("⚠️ Reminder configuration is incomplete. Please use `/reminder setup` to configure the reminder channel and role first.");
        return;
      }
      
      const scheduledTime = dayjs().add(delayMs, 'millisecond');
      const unixTimestamp = Math.floor(scheduledTime.valueOf() / 1000);

      // Use handleReminder from reminderUtils to properly save the reminder
      // This ensures consistency with how reminders are created elsewhere
      // Skip confirmation message since we send our own embed
      const mockMessage = { client: interaction.client };
      
      await handleReminder(mockMessage, delayMs, type, true);
      
      logger.info("Reminder saved via handleReminder:", {
        type,
        delayMs,
        scheduledTime: scheduledTime.toISOString()
      });
      
      const embed = new EmbedBuilder()
          .setColor(config.baseEmbedColor)
          .setTitle(`🔧 ${displayName} Reminder Fixed`)
          .setDescription(`${displayName} reminder successfully fixed! Next reminder scheduled <t:${unixTimestamp}:R>.`);
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info(`/fix ${type} command completed successfully:`, {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        scheduledTime: scheduledTime.toISOString()
      });
    } catch (error) {
      logger.error(`Error in /fix ${type} command`, {
        err: error,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });
      
      let errorMessage = `⚠️ An unexpected error occurred while fixing the ${displayName.toLowerCase()} reminder.`;
      
      if (error.message === "DATABASE_ERROR") {
        errorMessage = "⚠️ Failed to save reminder data to the database. Please try again later.";
      } else if (error.message === "CHANNEL_NOT_FOUND") {
        errorMessage = "⚠️ The reminder channel could not be found.";
      }
      
      try {
        await interaction.editReply({ 
          content: errorMessage,
          flags: MessageFlags.Ephemeral 
        });
      } catch (followUpError) {
        logger.error("Failed to send error response for fix command", {
          err: followUpError,
          originalError: error.message,
          userId: interaction.user?.id
        });
        
        await interaction.reply({ 
          content: errorMessage,
          flags: MessageFlags.Ephemeral 
        }).catch(() => {});
      }
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
    logger.error("Error in fix command", {
      err: error,
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
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for fix command", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {
      });
    }
  }
};
