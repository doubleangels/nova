const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
dayjs.extend(duration);
const { getValue, setValue, getReminderData } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// Setup a pool for direct SQL queries
const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

// We use these configuration constants for the reminder system.
const REMINDER_TYPE = 'bump';
const DB_KEY_CHANNEL = 'reminder_channel';
const DB_KEY_ROLE = 'reminder_role';

/**
 * Module for the /reminder command.
 * We allow administrators to setup and check bump reminder settings for server management.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Configure and manage Disboard bump reminders')
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('Set up the reminder channel and role')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('The channel where reminders will be sent')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('The role to ping for reminders')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current reminder configuration and status')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  /**
   * We execute the /reminder command.
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
   * We handle the setup of reminder configuration.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleReminderSetup(interaction) {
    // We retrieve the selected channel and role from the command options.
    const channelOption = interaction.options.getChannel('channel');
    const roleOption = interaction.options.getRole('role');
    
    // We validate that the channel is a text channel.
    if (channelOption.type !== ChannelType.GuildText) {
      throw new Error("INVALID_CHANNEL_TYPE");
    }
    
    // We save the selected channel and role IDs in the database.
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

    // We respond with a summary of the new configuration for confirmation.
    const response = `✅ **Reminder setup complete!**\n\n` +
                    `📢 **Channel:** <#${channelOption.id}>\n` +
                    `🎭 **Role:** <@&${roleOption.id}>\n\n` +
                    `Disboard bump reminders will be sent in <#${channelOption.id}> and will ping <@&${roleOption.id}>.`;
    await interaction.editReply(response);
  },
  
  /**
   * We handle checking the status of the current reminder configuration.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleReminderStatus(interaction) {
    logger.debug("Processing reminder status check.", { 
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    try {
      // We retrieve the current configuration and reminder data from the database.
      const [channelId, roleId] = await Promise.all([
        getValue(DB_KEY_CHANNEL),
        getValue(DB_KEY_ROLE)
      ]);
      
      // Get the latest reminder data
      const reminderData = await this.getLatestReminderData(channelId);
      
      logger.debug("Retrieved reminder configuration.", { 
        channelId, 
        roleId,
        hasReminderData: !!reminderData,
        guildId: interaction.guildId
      });
      
      // We resolve the channel name from the channel ID for display.
      let channelStr = '⚠️ Not set!';
      if (channelId) {
        const channelObj = interaction.guild.channels.cache.get(channelId);
        channelStr = channelObj ? `<#${channelId}>` : '⚠️ Invalid channel!';
      }
  
      // We format the role for display in the status message.
      let roleStr = '⚠️ Not set!';
      if (roleId) {
        const roleObj = interaction.guild.roles.cache.get(roleId);
        roleStr = roleObj ? `<@&${roleId}>` : '⚠️ Invalid role!';
      }
      
      // We calculate the remaining time until the next reminder is due.
      const timeStr = this.calculateRemainingTime(reminderData);
      
      // We check if the configuration is complete with both channel and role set.
      const configComplete = channelId && roleId;
      
      // We build a comprehensive summary message with all relevant information.
      let summary = `📌 **Disboard Reminder Status:**\n\n`;
      summary += `📢 **Channel:** ${channelStr}\n`;
      summary += `🎭 **Role:** ${roleStr}\n`;
      summary += `⏳ **Next Reminder:** ${timeStr}`;
      
      // We add a warning if the configuration is incomplete to alert the admin.
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
   * We get the latest reminder data for a channel.
   * @param {string} channelId - The channel ID to get reminder data for.
   * @returns {Promise<Object|null>} The reminder data if found, otherwise null.
   */
  async getLatestReminderData(channelId) {
    if (!channelId) return null;
    
    try {
      const result = await pool.query(
        `SELECT reminder_id, remind_at FROM main.reminder_recovery 
         WHERE remind_at > NOW()
         ORDER BY remind_at ASC 
         LIMIT 1`
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (err) {
      logger.error("Error getting latest reminder data:", { error: err });
      return null;
    }
  },

  /**
   * We calculate the time remaining until the next scheduled reminder.
   * @param {Object} reminderData - The reminder data from the database.
   * @returns {string} A formatted string showing the remaining time.
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
   * We handle errors that occur during command execution.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'reminder', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_READ_ERROR;
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_WRITE_ERROR;
    } else if (error.message === "INVALID_CHANNEL_TYPE") {
      errorMessage = ERROR_MESSAGES.REMINDER_INVALID_CHANNEL;
    } else if (error.message === "CONFIG_INCOMPLETE") {
      errorMessage = ERROR_MESSAGES.REMINDER_CONFIG_INCOMPLETE;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for reminder command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // Silent catch if everything fails.
      });
    }
  }
};