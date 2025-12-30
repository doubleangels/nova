const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
dayjs.extend(duration);
const { getValue, setValue } = require('../utils/database');
const { getLatestReminderData } = require('../utils/reminderUtils');

/**
 * Command module for configuring and managing reminders.
 * Handles setup of reminder channels and roles, displays reminder status, and fixes reminder data.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Configure and manage server reminders (Disboard, Discadia, and Reddit promotions).')
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('Set up the reminder channel and role.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('What channel do you want to send reminders to?')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('What role do you want to ping for reminders?')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current reminder configuration and status.')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  /**
   * Executes the reminder command.
   * This function:
   * 1. Defers the reply
   * 2. Processes the subcommand (setup or status)
   * 3. Handles any errors that occur
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {      
      logger.info("/reminder command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand: interaction.options.getSubcommand()
      });
      
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'setup') {
        await this.handleReminderSetup(interaction);
      } else if (subcommand === 'status') {
        await this.handleReminderStatus(interaction);
      }
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles the reminder setup subcommand.
   * This function:
   * 1. Validates channel type
   * 2. Updates database with channel and role settings
   * 3. Sends confirmation embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error setting up reminders
   * @returns {Promise<void>}
   */
  async handleReminderSetup(interaction) {
    const channelOption = interaction.options.getChannel('channel');
    const roleOption = interaction.options.getRole('role');
    
    if (channelOption.type !== ChannelType.GuildText) {
      throw new Error("INVALID_CHANNEL_TYPE");
    }
    
    try {
      await Promise.all([
        setValue('reminder_channel', channelOption.id),
        setValue('reminder_role', roleOption.id)
      ]);
    } catch (dbError) {
      logger.error("Database operation failed during reminder setup:", { 
        error: dbError.message, 
        stack: dbError.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      throw new Error("DATABASE_WRITE_ERROR");
    }
    
    logger.info("/reminder command completed successfully:", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: channelOption.id,
      roleId: roleOption.id
    });

    const embed = new EmbedBuilder()
      .setColor(0xc03728)
      .setTitle('⏰ Reminder Setup Complete')
      .addFields(
        { name: '📢 Channel', value: `<#${channelOption.id}>` },
        { name: '🎭 Role', value: `<@&${roleOption.id}>` }
      )
      .setDescription(`Reminders will be sent in <#${channelOption.id}> and will ping <@&${roleOption.id}>.`);

    await interaction.editReply({ embeds: [embed] });
  },
  
  /**
   * Handles the reminder status subcommand.
   * This function:
   * 1. Retrieves current reminder configuration
   * 2. Gets latest reminder data
   * 3. Displays status embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error retrieving reminder status
   * @returns {Promise<void>}
   */
  async handleReminderStatus(interaction) {
    logger.debug("Processing reminder status check:", { 
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    try {
      const [channelId, roleId] = await Promise.all([
        getValue('reminder_channel'),
        getValue('reminder_role')
      ]);
      
      const [bumpReminder, discadiaReminder, promoteReminder] = await Promise.all([
        this.getLatestReminderData(channelId, 'bump'),
        this.getLatestReminderData(channelId, 'discadia'),
        this.getLatestReminderData(channelId, 'promote')
      ]);
      
      logger.debug("Retrieved reminder configuration:", { 
        channelId, 
        roleId,
        hasBumpReminder: !!bumpReminder,
        hasDiscadiaReminder: !!discadiaReminder,
        hasPromoteReminder: !!promoteReminder,
        guildId: interaction.guildId
      });
      
      let channelStr = '⚠️ Not set!';
      if (channelId) {
        const channelObj = interaction.guild.channels.cache.get(channelId);
        channelStr = channelObj ? `<#${channelId}>` : '⚠️ Invalid channel!';
      }
  
      let roleStr = '⚠️ Not set!';
      if (roleId) {
        const roleObj = interaction.guild.roles.cache.get(roleId);
        roleStr = roleObj ? `<@&${roleId}>` : '⚠️ Invalid role!';
      }
      
      const bumpTimeStr = this.calculateRemainingTime(bumpReminder);
      const discadiaTimeStr = this.calculateRemainingTime(discadiaReminder);
      const promoteTimeStr = this.calculateRemainingTime(promoteReminder);
      const configComplete = channelId && roleId;
      
      const embed = new EmbedBuilder()
        .setColor(0xc03728)
        .setTitle('⏰ Server Reminders Status')
        .addFields(
          { name: '📢 Channel', value: channelStr },
          { name: '🎭 Role', value: roleStr },
          { name: '⏰ Next Bump (Disboard)', value: bumpTimeStr },
          { name: '⏰ Next Bump (Discadia)', value: discadiaTimeStr },
          { name: '🎯 Next Promotion', value: promoteTimeStr }
        );

      if (!configComplete) {
        embed.setDescription('⚠️ **Warning:** Reminder configuration is incomplete.');
      }

      await interaction.editReply({ embeds: [embed] });
      logger.info("/reminder command completed successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        configComplete
      });
    } catch (dbError) {
      logger.error("Database operation failed while retrieving reminder data:", { 
        error: dbError.message, 
        stack: dbError.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      throw new Error("DATABASE_READ_ERROR");
    }
  },

  /**
   * Retrieves the latest reminder data for a specific type.
   * 
   * @param {string} channelId - The ID of the channel to check (not used with Keyv, kept for compatibility)
   * @param {string} type - The type of reminder ('bump', 'discadia', or 'promote')
   * @returns {Promise<Object|null>} The latest reminder data or null if none found
   */
  async getLatestReminderData(channelId, type) {
    if (!channelId) return null;
    
    try {
      return await getLatestReminderData(type);
    } catch (err) {
      logger.error("Error getting latest reminder data:", { error: err, type });
      return null;
    }
  },

  /**
   * Calculates the remaining time until a reminder.
   * 
   * @param {Object} reminderData - The reminder data containing the scheduled time
   * @returns {string} Formatted string showing remaining time
   */
  calculateRemainingTime(reminderData) {
    if (!reminderData || !reminderData.remind_at) {
      return '⚠️ Not scheduled!';
    }
  
    const now = dayjs();
    const scheduled = dayjs(reminderData.remind_at);
    const diffMs = scheduled.diff(now);
    
    if (diffMs <= 0) {
      return '⏰ Reminder is overdue!';
    }

    return `⏰ <t:${Math.floor(scheduled.valueOf() / 1000)}:R>`;
  },
  
  /**
   * Handles errors that occur during command execution.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in reminder command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while managing reminders.";
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = "⚠️ Failed to retrieve reminder settings. Please try again later.";
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = "⚠️ Failed to update reminder settings. Please try again later.";
    } else if (error.message === "INVALID_CHANNEL_TYPE") {
      errorMessage = "⚠️ Please select a text channel for reminders.";
    } else if (error.message === "CONFIG_INCOMPLETE") {
      errorMessage = "⚠️ Reminder configuration is incomplete. Please set up the reminder channel first.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for reminder command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  }
};