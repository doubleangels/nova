/**
 * Reminder command module for managing Disboard bump reminders.
 * Handles channel and role configuration, reminder scheduling, and status updates.
 * @module commands/reminder
 */

const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
dayjs.extend(duration);
const { getValue, setValue, getReminderData } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

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
    .setDescription('Configure and manage Disboard bump reminders.')
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
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the command execution fails
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {      
      logger.info("Reminder command initiated:", {
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
   * Handles the setup of reminder configuration.
   * @async
   * @function handleReminderSetup
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If setup fails
   */
  async handleReminderSetup(interaction) {
    const channelOption = interaction.options.getChannel('channel');
    const roleOption = interaction.options.getRole('role');
    
    if (channelOption.type !== ChannelType.GuildText) {
      throw new Error("INVALID_CHANNEL_TYPE");
    }
    
    try {
      await Promise.all([
        setValue(DB_KEY_CHANNEL, channelOption.id),
        setValue(DB_KEY_ROLE, roleOption.id)
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
    
    logger.info("Reminder configuration updated successfully:", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: channelOption.id,
      roleId: roleOption.id
    });

    const embed = new EmbedBuilder()
      .setColor('#cd41ff')
      .setTitle('✅ Reminder Setup Complete')
      .addFields(
        { name: '📢 Channel', value: `<#${channelOption.id}>` },
        { name: '🎭 Role', value: `<@&${roleOption.id}>` }
      )
      .setDescription(`Disboard bump reminders will be sent in <#${channelOption.id}> and will ping <@&${roleOption.id}>.`)
      .setFooter({ text: `Updated by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
  
  /**
   * Handles checking the status of the current reminder configuration.
   * @async
   * @function handleReminderStatus
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If status check fails
   */
  async handleReminderStatus(interaction) {
    logger.debug("Processing reminder status check:", { 
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    try {
      const [channelId, roleId] = await Promise.all([
        getValue(DB_KEY_CHANNEL),
        getValue(DB_KEY_ROLE)
      ]);
      
      const [bumpReminder, promoteReminder] = await Promise.all([
        this.getLatestReminderData(channelId, 'bump'),
        this.getLatestReminderData(channelId, 'promote')
      ]);
      
      logger.debug("Retrieved reminder configuration:", { 
        channelId, 
        roleId,
        hasBumpReminder: !!bumpReminder,
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
      const promoteTimeStr = this.calculateRemainingTime(promoteReminder);
      const configComplete = channelId && roleId;
      
      const embed = new EmbedBuilder()
        .setColor('#cd41ff')
        .setTitle('📌 Server Reminders Status')
        .addFields(
          { name: '📢 Channel', value: channelStr },
          { name: '🎭 Role', value: roleStr },
          { name: '⏰ Next Bump', value: bumpTimeStr },
          { name: '🎯 Next Promotion', value: promoteTimeStr }
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      if (!configComplete) {
        embed.setDescription('⚠️ **Warning:** Reminder configuration is incomplete.');
      }

      await interaction.editReply({ embeds: [embed] });
      logger.info("Reminder status check completed successfully:", {
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
   * Gets the latest reminder data for a channel and type.
   * @async
   * @function getLatestReminderData
   * @param {string} channelId - The channel ID to get reminder data for
   * @param {string} type - The type of reminder to get ('bump' or 'promote')
   * @returns {Promise<Object|null>} The reminder data if found, otherwise null
   */
  async getLatestReminderData(channelId, type) {
    if (!channelId) return null;
    
    try {
      const result = await pool.query(
        `SELECT reminder_id, remind_at, type FROM main.reminder_recovery 
         WHERE remind_at > NOW() AND type = $1
         ORDER BY remind_at ASC 
         LIMIT 1`,
        [type]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (err) {
      logger.error("Error getting latest reminder data:", { error: err, type });
      return null;
    }
  },

  /**
   * Calculates the time remaining until the next scheduled reminder.
   * @function calculateRemainingTime
   * @param {Object} reminderData - The reminder data from the database
   * @returns {string} A formatted string showing the remaining time
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
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
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
      });
    }
  }
};