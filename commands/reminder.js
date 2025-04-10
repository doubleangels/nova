const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
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
          content: '⚠️ An unexpected error occurred. Please try again later.',
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
          content: '⚠️ An unexpected error occurred. Please try again later.',
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
  try {
    await setValue(DB_KEY_CHANNEL, channelOption.id);
    await setValue(DB_KEY_ROLE, roleOption.id);
  } catch (dbError) {
    logger.error("Database operation failed during reminder setup.", { 
      error: dbError.message, 
      stack: dbError.stack,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
    await interaction.editReply({
      content: "⚠️ Failed to save reminder settings. Please try again later.",
      ephemeral: true
    });
    return;
  }
  
  logger.info("Reminder configuration updated successfully.", {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: channelOption.id,
    roleId: roleOption.id
  });

  // Respond with a summary of the new configuration.
  const response = `✅ **Reminder setup complete!**\n📢 Reminders will be sent in <#${channelOption.id}>.\n🎭 The role to be pinged is <@&${roleOption.id}>.`;
    
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

  let channelId, roleId, reminderData;

  // Retrieve current reminder configuration from the database.
  try {
    channelId = await getValue(DB_KEY_CHANNEL);
    roleId = await getValue(DB_KEY_ROLE);
    
    logger.debug("Retrieved reminder configuration.", { 
      channelId, 
      roleId,
      guildId: interaction.guildId
    });
  } catch (dbError) {
    logger.error("Database operation failed while retrieving reminder configuration.", { 
      error: dbError.message, 
      stack: dbError.stack,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
    await interaction.editReply({
      content: "⚠️ Failed to retrieve reminder settings. Please try again later.",
      ephemeral: true
    });
    return;
  }

  // Resolve the channel name from the channel ID.
  let channelStr = 'Not set!';
  if (channelId) {
    const channelObj = interaction.guild.channels.cache.get(channelId);
    channelStr = channelObj ? `<#${channelId}>` : 'Not set!';
  }
  
  // Format the role for display.
  const roleStr = roleId ? `<@&${roleId}>` : 'Not set!';

  // Retrieve the current reminder data.
  try {
    reminderData = await getReminderData(REMINDER_TYPE);
  } catch (dbError) {
    logger.error("Database operation failed while retrieving reminder data.", { 
      error: dbError.message, 
      stack: dbError.stack,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
    await interaction.editReply({
      content: "⚠️ Failed to retrieve reminder timing data. Please try again later.",
      ephemeral: true
    });
    return;
  }
  
  // Calculate the remaining time until the next reminder.
  const timeStr = calculateRemainingTime(reminderData);

  // Build the summary message with the current reminder settings.
  const summary = `📌 **Disboard Reminder Status:**\n📢 **Channel:** ${channelStr}\n🎭 **Role:** ${roleStr}\n\n⏳ **Disboard**: ${timeStr}`;

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
    return 'Not set!';
  }
  
  const now = dayjs();
  const scheduled = dayjs(reminderData.scheduled_time);
  const diffMs = scheduled.diff(now);
  
  if (diffMs <= 0) {
    return 'Reminder is overdue';
  }
  
  const diffDuration = dayjs.duration(diffMs);
  const hours = diffDuration.hours();
  const minutes = diffDuration.minutes();
  const seconds = diffDuration.seconds();
  
  return `${hours}h ${minutes}m ${seconds}s`;
}
