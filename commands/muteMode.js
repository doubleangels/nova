const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue } = require('../utils/supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mutemode')
    .setDescription("Toggle auto-kicking of users who don't send a message within a time limit.")
    .addStringOption(option =>
      option
        .setName('enabled')
        .setDescription('Enable or disable mute mode')
        .setRequired(true)
        .addChoices(
          { name: 'Enabled', value: 'enabled' },
          { name: 'Disabled', value: 'disabled' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('time')
        .setDescription('Time limit in hours before a silent user is kicked (Default: 2)')
        .setRequired(false)
    ),
  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      logger.warn(`Unauthorized /mutemode attempt by ${interaction.user.tag}`);
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }

    try {
      logger.debug(`/mutemode command received from ${interaction.user.tag}`);
      
      const enabledInput = interaction.options.getString('enabled');
      const timeLimit = interaction.options.getInteger('time') ?? 2;
      const isEnabled = enabledInput.toLowerCase() === 'enabled';

      logger.debug(`Mute mode toggle: ${isEnabled ? 'Enabled' : 'Disabled'}, Kick Time: ${timeLimit} hours`);

      await setValue("mute_mode_enabled", isEnabled);
      await setValue("mute_mode_kick_time_hours", timeLimit);

      const responseMessage = isEnabled
        ? `🔇 Mute mode has been ✅ **enabled**. New users must send a message within **${timeLimit}** hours or be kicked.`
        : `🔇 Mute mode has been ❌ **disabled**.`;

      await interaction.reply(responseMessage);
      logger.debug(`Mute mode ${isEnabled ? 'enabled' : 'disabled'} by ${interaction.user.tag}, kick time set to ${timeLimit} hours.`);
    } catch (error) {
      logger.error(`Error in /mutemode command: ${error}`);
      await interaction.reply({ content: "⚠️ An error occurred while toggling mute mode. Please try again later.", ephemeral: true });
    }
  }
};
