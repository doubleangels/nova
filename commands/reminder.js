const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
dayjs.extend(duration);
const { getValue, setValue, getReminderData } = require('../utils/database');

// Configuration constants
const REMINDER_TYPE = 'bump';
const DB_KEY_CHANNEL = 'reminder_channel';
const DB_KEY_ROLE = 'reminder_role';

/**
 * Module for the /reminder command.
 * Allows administrators to setup and check bump reminder settings.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Setup and check the status of bump reminders.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('Configure the channel and role for bump reminders')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('What channel do you want reminders in?')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
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
        .setDescription('Check the current reminder settings and next scheduled reminder')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  /**
   * Executes the /reminder command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {      
      logger.info("Reminder command initiated.", {
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
   * Handles the setup of a new reminder configuration.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleReminderSetup(interaction) {
    const channelOption = interaction.options.getChannel('channel');
    const roleOption = interaction.options.getRole('role');
    logger.debug("Processing reminder setup.", { 
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: channelOption.id,
      channelType: channelOption.type,
      roleId: roleOption.id 
    });
  
    // Validate the channel type
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channelOption.type)) {
      logger.warn("Invalid channel type selected.", {
        userId: interaction.user.id,
        channelId: channelOption.id,
        channelType: channelOption.type
      });

      return await interaction.editReply({
        content: "⚠️ Please select a text channel for reminders."
      });
    }

    // Validate role is mentionable
    if (!roleOption.mentionable) {
      logger.warn("Non-mentionable role selected.", {
        userId: interaction.user.id,
        roleId: roleOption.id,
        roleName: roleOption.name
      });

      return await interaction.editReply({
        content: "⚠️ The selected role is not mentionable. Please choose a role that can be mentioned."
      });
    }
    
    // Save the selected channel and role in the database
    try {
      await Promise.all([
        setValue(DB_KEY_CHANNEL, channelOption.id),
        setValue(DB_KEY_ROLE, roleOption.id)
      ]);
    } catch (dbError) {
      logger.error("Database operation failed during reminder setup.", { 
        error: dbError.message, 
        stack: dbError.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      throw new Error("DATABASE_WRITE_ERROR");
    }
    
    logger.info("Reminder configuration updated successfully.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: channelOption.id,
      roleId: roleOption.id
    });

    // Respond with a summary of the new configuration
    const response = `✅ **Reminder setup complete!**\n\n` +
                    `📢 **Channel:** <#${channelOption.id}>\n` +
                    `🎭 **Role:** <@&${roleOption.id}>\n\n` +
                    `Disboard bump reminders will be sent in <#${channelOption.id}> and will ping <@&${roleOption.id}>.`;
    await interaction.editReply(response);
  },
  
  /**
   * Handles checking the status of the current reminder configuration.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleReminderStatus(interaction) {
    logger.debug("Processing reminder status check.", { 
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    try {
      // Retrieve current configuration and reminder data
      const [channelId, roleId, reminderData] = await Promise.all([
        getValue(DB_KEY_CHANNEL),
        getValue(DB_KEY_ROLE),
        getReminderData(REMINDER_TYPE)
      ]);
      
      logger.debug("Retrieved reminder configuration.", { 
        channelId, 
        roleId,
        hasReminderData: !!reminderData,
        guildId: interaction.guildId
      });
      
      // Resolve the channel name from the channel ID
      let channelStr = '⚠️ Not set!';
      if (channelId) {
        const channelObj = interaction.guild.channels.cache.get(channelId);
        channelStr = channelObj ? `<#${channelId}>` : '⚠️ Invalid channel!';
      }
  
      // Format the role for display
      let roleStr = '⚠️ Not set!';
      if (roleId) {
        const roleObj = interaction.guild.roles.cache.get(roleId);
        roleStr = roleObj ? `<@&${roleId}>` : '⚠️ Invalid role!';
      }
      
      // Calculate the remaining time until the next reminder
      const timeStr = this.calculateRemainingTime(reminderData);
      
      // Check if configuration is incomplete
      const configComplete = channelId && roleId;
      
      // Build the summary message
      let summary = `📌 **Disboard Reminder Status:**\n\n`;
      summary += `📢 **Channel:** ${channelStr}\n`;
      summary += `🎭 **Role:** ${roleStr}\n\n`;
      summary += `⏳ **Next Reminder:** ${timeStr}`;
      
      // Add a warning if configuration is incomplete
      if (!configComplete) {
        summary += `\n\n⚠️ **Warning:** Reminder configuration is incomplete.`;
      }

      await interaction.editReply(summary);
      logger.info("Reminder status check completed successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        configComplete
      });
    } catch (dbError) {
      logger.error("Database operation failed while retrieving reminder data.", { 
        error: dbError.message, 
        stack: dbError.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      throw new Error("DATABASE_READ_ERROR");
    }
  },

  /**
   * Calculates the time remaining until the next scheduled reminder.
   * @param {Object} reminderData - The reminder data from the database.
   * @returns {string} A formatted string showing the remaining time.
   */
  calculateRemainingTime(reminderData) {
    if (!reminderData || !reminderData.scheduled_time) {
      return '⚠️ Not scheduled!';
    }
  
    const now = dayjs();
    const scheduled = dayjs(reminderData.scheduled_time);
    const diffMs = scheduled.diff(now);
    
    if (diffMs <= 0) {
      return '⏰ Reminder is overdue!';
    }
    const diffDuration = dayjs.duration(diffMs);
    const hours = Math.floor(diffDuration.asHours());
    const minutes = diffDuration.minutes();
    const seconds = diffDuration.seconds();
  
    return `⏰ ${hours}h ${minutes}m ${seconds}s remaining`;
  },
  
  /**
   * Handles errors that occur during command execution.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logger.error("Error executing reminder command.", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
    
    let errorMessage = '⚠️ An unexpected error occurred. Please try again later.';
    
    if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = "⚠️ Failed to save reminder settings. Please try again later.";
    } else if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = "⚠️ Failed to retrieve reminder settings. Please try again later.";
    }

    // Handle case where interaction wasn't deferred properly
    try {
      await interaction.editReply({ content: errorMessage });
    } catch (followUpError) {
      logger.error("Failed to send error response for reminder command.", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user.id
      });
      
      // Try replying if editing failed
      await interaction.reply({ content: errorMessage })
        .catch(() => {
          // Silent catch if everything fails
        });
    }
  }
};