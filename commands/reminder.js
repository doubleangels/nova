const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
dayjs.extend(duration);
const { getValue, setValue, getReminderData, isConnected } = require('../utils/database');

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'reminder',
  DESCRIPTION: 'Setup and check the status of bump reminders.',
  REMINDER_TYPE: 'bump',
  DB_KEYS: {
    CHANNEL: 'reminder_channel',
    ROLE: 'reminder_role'
  },
  RESPONSES: {
    SETUP_SUCCESS: '✅ **Reminder setup complete!**\n📢 Reminders will be sent in <#%s>.\n🎭 The role to be pinged is <@&%s>.',
    STATUS_HEADER: '📌 **Disboard Reminder Status:**\n📢 **Channel:** %s\n🎭 **Role:** %s\n\n⏳ **Disboard**: %s',
    NOT_SET: 'Not set!',
    OVERDUE: 'Reminder is overdue',
    ERROR: '⚠️ An unexpected error occurred. Please try again later.',
    DB_ERROR: '⚠️ Database connection error. Please check server logs.'
  }
};

/**
 * Module for the /reminder command.
 * Allows administrators to setup and check bump reminder settings.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_CONFIG.NAME)
    .setDescription(COMMAND_CONFIG.DESCRIPTION)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('What channel do you want reminders in?')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('What role do you want to ping for reminders?')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  /**
   * Executes the /reminder command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {
      // Check database connection before proceeding.
      if (!isConnected()) {
        logger.error("Failed to execute reminder command due to database connection issue.", {
          userId: interaction.user.id,
          guildId: interaction.guildId
        });
        
        return await interaction.editReply({
          content: COMMAND_CONFIG.RESPONSES.DB_ERROR,
          ephemeral: true
        });
      }
      
      logger.info("Reminder command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Retrieve channel and role options from the command input.
      const channelOption = interaction.options.getChannel('channel');
      const roleOption = interaction.options.getRole('role');

      // Process setup configuration if both options are provided.
      if (channelOption && roleOption) {
        await handleReminderSetup(interaction, channelOption, roleOption);
      } else {
        // Otherwise, perform a status check.
        await handleReminderStatus(interaction);
      }
      
    } catch (error) {
      logger.error("Error executing reminder command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Handle case where interaction wasn't deferred properly.
      try {
        await interaction.editReply({
          content: COMMAND_CONFIG.RESPONSES.ERROR,
          ephemeral: true
        });
      } catch (followUpError) {
        logger.error("Failed to send error response for reminder command.", {
          error: followUpError.message,
          originalError: error.message,
          userId: interaction.user.id
        });
        
        // Try replying if editing failed.
        await interaction.reply({
          content: COMMAND_CONFIG.RESPONSES.ERROR,
          ephemeral: true
        }).catch(() => {
          // Silent catch if everything fails.
        });
      }
    }
  }
};

/**
 * Handles the setup of a new reminder configuration.
 * @param {Interaction} interaction - The Discord interaction object.
 * @param {Channel} channelOption - The selected channel for reminders.
 * @param {Role} roleOption - The selected role to ping.
 */
async function handleReminderSetup(interaction, channelOption, roleOption) {
  logger.debug("Processing reminder setup.", { 
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: channelOption.id,
    roleId: roleOption.id 
  });
  
  // Save the selected channel and role in the database.
  await setValue(COMMAND_CONFIG.DB_KEYS.CHANNEL, channelOption.id);
  await setValue(COMMAND_CONFIG.DB_KEYS.ROLE, roleOption.id);
  
  logger.info("Reminder configuration updated successfully.", {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: channelOption.id,
    roleId: roleOption.id
  });

  // Respond with a summary of the new configuration.
  const response = COMMAND_CONFIG.RESPONSES.SETUP_SUCCESS
    .replace('%s', channelOption.id)
    .replace('%s', roleOption.id);
    
  await interaction.editReply(response);
}

/**
 * Handles checking the status of the current reminder configuration.
 * @param {Interaction} interaction - The Discord interaction object.
 */
async function handleReminderStatus(interaction) {
  logger.debug("Processing reminder status check.", { 
    userId: interaction.user.id,
    guildId: interaction.guildId
  });

  // Retrieve current reminder configuration from the database.
  const channelId = await getValue(COMMAND_CONFIG.DB_KEYS.CHANNEL);
  const roleId = await getValue(COMMAND_CONFIG.DB_KEYS.ROLE);
  
  logger.debug("Retrieved reminder configuration.", { 
    channelId, 
    roleId,
    guildId: interaction.guildId
  });

  // Resolve the channel name from the channel ID.
  let channelStr = COMMAND_CONFIG.RESPONSES.NOT_SET;
  if (channelId) {
    const channelObj = interaction.guild.channels.cache.get(channelId);
    channelStr = channelObj ? `<#${channelId}>` : COMMAND_CONFIG.RESPONSES.NOT_SET;
  }
  
  // Format the role for display.
  const roleStr = roleId ? `<@&${roleId}>` : COMMAND_CONFIG.RESPONSES.NOT_SET;

  // Retrieve the current reminder data.
  const reminderData = await getReminderData(COMMAND_CONFIG.REMINDER_TYPE);
  
  // Calculate the remaining time until the next reminder.
  const timeStr = calculateRemainingTime(reminderData);

  // Build the summary message with the current reminder settings.
  const summary = COMMAND_CONFIG.RESPONSES.STATUS_HEADER
    .replace('%s', channelStr)
    .replace('%s', roleStr)
    .replace('%s', timeStr);

  await interaction.editReply(summary);
  logger.info("Reminder status check completed successfully.", {
    userId: interaction.user.id,
    guildId: interaction.guildId
  });
}

/**
 * Calculates the time remaining until the next scheduled reminder.
 * @param {Object} reminderData - The reminder data from the database.
 * @returns {string} A formatted string showing the remaining time.
 */
function calculateRemainingTime(reminderData) {
  if (!reminderData || !reminderData.scheduled_time) {
    return COMMAND_CONFIG.RESPONSES.NOT_SET;
  }
  
  const now = dayjs();
  const scheduled = dayjs(reminderData.scheduled_time);
  const diffMs = scheduled.diff(now);
  
  if (diffMs <= 0) {
    return COMMAND_CONFIG.RESPONSES.OVERDUE;
  }
  
  const diffDuration = dayjs.duration(diffMs);
  const hours = diffDuration.hours();
  const minutes = diffDuration.minutes();
  const seconds = diffDuration.seconds();
  
  return `${hours}h ${minutes}m ${seconds}s`;
}
