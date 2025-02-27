const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue, getReminderData } = require('../utils/supabase');
const { calculateRemainingTime } = require('../utils/reminderUtils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Setup and check the status of bump reminders.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to send reminders in (leave empty to check status)')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to ping in reminders (leave empty to check status)')
        .setRequired(false)
    ),
  async execute(interaction) {
    try {
      logger.debug(`/reminder command invoked by ${interaction.user.tag}`);
      
      const channelOption = interaction.options.getChannel('channel');
      const roleOption = interaction.options.getRole('role');

      if (channelOption && roleOption) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          logger.warn(`Unauthorized /reminder setup attempt by ${interaction.user.tag}`);
          await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
          return;
        }

        logger.debug(`Reminder setup requested by ${interaction.user.tag}. Channel: ${channelOption.name}, Role: ${roleOption.id}`);
        await setValue('reminder_channel', channelOption.id);
        await setValue('reminder_role', roleOption.id);
        logger.debug('Reminder configuration saved successfully.');

        await interaction.reply(
          `✅ **Reminder setup complete!**\n` +
          `📢 Reminders will be sent in ${channelOption.name}.\n` +
          `🎭 The role to be pinged is <@&${roleOption.id}>.`
        );
        return;
      }

      logger.debug(`Reminder status check requested by ${interaction.user.tag}.`);

      const channelId = await getValue('reminder_channel');
      const roleId = await getValue('reminder_role');

      logger.debug(`Current Reminder Channel: ${channelId}`);
      logger.debug(`Current Reminder Role: ${roleId}`);

      let channelStr = 'Not set!';
      if (channelId) {
        const channelObj = interaction.guild.channels.cache.get(channelId);
        channelStr = channelObj ? channelObj.name : 'Not set!';
      }
      const roleStr = roleId ? `<@&${roleId}>` : 'Not set!';

      const data = await getReminderData('disboard');
      const timeStr = data && data.scheduled_time
        ? calculateRemainingTime(data.scheduled_time)
        : 'Not set!';
      const reminderInfo = `⏳ **Disboard**: ${timeStr}`;

      const summary =
        `📌 **Disboard Reminder Status:**\n` +
        `📢 **Channel:** ${channelStr}\n` +
        `🎭 **Role:** ${roleStr}\n\n` +
        `${reminderInfo}`;

      await interaction.reply(summary);
    } catch (error) {
      logger.error('Error in /reminder command:', error);
      await interaction.reply({
        content: '⚠️ An error occurred while processing your request. Please try again later.',
        ephemeral: true
      });
    }
  }
};
