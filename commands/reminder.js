const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
dayjs.extend(duration);
const { getValue, setValue, getReminderData } = require('../utils/database');

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
      logger.debug("/reminder command received:", { user: interaction.user.tag });
      
      // Retrieve channel and role options from the command input.
      const channelOption = interaction.options.getChannel('channel');
      const roleOption = interaction.options.getRole('role');

      // If both options are provided, process the setup configuration.
      if (channelOption && roleOption) {
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
        await interaction.editReply(
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

      // Retrieve the current reminder data for the 'bump' service.
      const reminderData = await getReminderData('bump');

      // Calculate the remaining time until the next reminder using day.js.
      const timeStr = reminderData && reminderData.scheduled_time
        ? (() => {
            const now = dayjs();
            const scheduled = dayjs(reminderData.scheduled_time);
            const diffMs = scheduled.diff(now);
            if (diffMs <= 0) return "Reminder is overdue";
            const diffDuration = dayjs.duration(diffMs);
            const hours = diffDuration.hours();
            const minutes = diffDuration.minutes();
            const seconds = diffDuration.seconds();
            return `${hours}h ${minutes}m ${seconds}s`;
          })()
        : 'Not set!';

      const reminderInfo = `⏳ **Disboard**: ${timeStr}`;

      // Build the summary message with the current reminder settings.
      const summary =
        `📌 **Disboard Reminder Status:**\n` +
        `📢 **Channel:** ${channelStr}\n` +
        `🎭 **Role:** ${roleStr}\n\n` +
        `${reminderInfo}`;

      await interaction.editReply(summary);
      logger.debug("Reminder status reply sent:", { summary });
    } catch (error) {
      logger.error("Error in /reminder command:", { error });
      await interaction.editReply({ 
        content: "⚠️ An unexpected error occurred. Please try again later.", 
        ephemeral: true 
      });
    }
  }
};
