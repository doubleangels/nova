const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue, getReminderData } = require('../utils/supabase');
const { calculateRemainingTime } = require('../utils/reminderUtils');

/**
 * Module for the /reminder command.
 * This command is used to setup and check the status of bump reminders.
 * - When both channel and role options are provided, it sets up the reminder configuration.
 * - When no options are provided, it returns the current reminder status.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Setup and check the status of bump reminders.')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send reminders in (leave empty to check status)')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role to ping in reminders (leave empty to check status)')
        .setRequired(false)
    ),

  /**
   * Executes the /reminder command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      logger.debug("/reminder command received:", { user: interaction.user.tag });
      
      // Retrieve channel and role options from the command input.
      const channelOption = interaction.options.getChannel('channel');
      const roleOption = interaction.options.getRole('role');

      // If both options are provided, process the setup configuration.
      if (channelOption && roleOption) {
        // Check for Administrator permissions.
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          logger.warn("Unauthorized /reminder attempt:", { user: interaction.user.tag });
          await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
          return;
        }

        logger.debug("Processing reminder setup", { 
          user: interaction.user.tag,
          channel: channelOption.id,
          role: roleOption.id 
        });
        
        // Save the selected channel and role in the database.
        await setValue('reminder_channel', channelOption.id);
        await setValue('reminder_role', roleOption.id);
        logger.debug("Reminder configuration saved successfully.");

        // Respond with a summary of the new configuration.
        await interaction.reply(
          `✅ **Reminder setup complete!**\n` +
          `📢 Reminders will be sent in <#${channelOption.id}>.\n` +
          `🎭 The role to be pinged is <@&${roleOption.id}>.`
        );
        return;
      }

      // If no options are provided, perform a status check.
      logger.debug("Reminder status check requested:", { user: interaction.user.tag });

      // Retrieve current reminder configuration from the database.
      const channelId = await getValue('reminder_channel');
      const roleId = await getValue('reminder_role');
      logger.debug("Current configuration retrieved:", { channelId, roleId });

      // Resolve the channel name from the channel ID.
      let channelStr = 'Not set!';
      if (channelId) {
        const channelObj = interaction.guild.channels.cache.get(channelId);
        channelStr = channelObj ? `<#${channelId}>` : 'Not set!';
      }
      // Format the role for display.
      const roleStr = roleId ? `<@&${roleId}>` : 'Not set!';

      // Retrieve the current reminder data for the 'disboard' service.
      const reminderData = await getReminderData('bump');
      // Calculate the remaining time until the next reminder if available.
      const timeStr = reminderData && reminderData.scheduled_time
        ? calculateRemainingTime(reminderData.scheduled_time)
        : 'Not set!';
      const reminderInfo = `⏳ **Disboard**: ${timeStr}`;

      // Build the summary message with the current reminder settings.
      const summary =
        `📌 **Disboard Reminder Status:**\n` +
        `📢 **Channel:** ${channelStr}\n` +
        `🎭 **Role:** ${roleStr}\n\n` +
        `${reminderInfo}`;

      await interaction.reply(summary);
      logger.debug("Reminder status reply sent:", { summary });
    } catch (error) {
      logger.error("Error in /reminder command:", { error });
      await interaction.reply({
        content: '⚠️ An error occurred while processing your request. Please try again later.',
        ephemeral: true
      });
    }
  }
};
