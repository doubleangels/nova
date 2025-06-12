const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
dayjs.extend(duration);
const { getValue, setValue, getReminderData } = require('../utils/database');
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.neonConnectionString,
  ssl: { rejectUnauthorized: true }
});

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
        .setFooter({ text: `Updated by ${interaction.user.tag}` })
        .setTimestamp();

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
      }).catch(() => {});
    }
  }
};