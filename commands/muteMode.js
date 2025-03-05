const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../logger')('muteMode.js');
const { setValue } = require('../utils/supabase');

/**
 * Module for the /mutemode command.
 * Toggles auto-kicking of users who don't send a message within a specified time limit.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('mutemode')
    .setDescription("Toggle auto-kicking of users who don't send a message within a time limit.")
    .addStringOption(option =>
      option
        .setName('enabled')
        .setDescription('Do you want to enable or disable mute mode?')
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
    
  /**
   * Executes the /mutemode command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    // Check if the user has Administrator permissions.
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      logger.warn("Unauthorized /mutemode attempt:", { user: interaction.user.tag });
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }

    try {
      logger.debug("/mutemode command received:", { user: interaction.user.tag });
      
      // Get the 'enabled' input and time limit (default is 2 hours).
      const enabledInput = interaction.options.getString('enabled');
      const timeLimit = interaction.options.getInteger('time') ?? 2;
      const isEnabled = enabledInput.toLowerCase() === 'enabled';

      logger.debug("Parsed mute mode command:", { isEnabled, timeLimit });

      // Update the settings in the database.
      await setValue("mute_mode_enabled", isEnabled);
      await setValue("mute_mode_kick_time_hours", timeLimit);

      // Prepare the response message based on the mode.
      const responseMessage = isEnabled
        ? `🔇 Mute mode has been ✅ **enabled**. New users must send a message within **${timeLimit}** hours or be kicked.`
        : `🔇 Mute mode has been ❌ **disabled**.`;

      // Reply to the interaction.
      await interaction.reply(responseMessage);
      logger.debug("Mute mode configuration updated:", { user: interaction.user.tag, isEnabled, timeLimit });
    } catch (error) {
      logger.error("Error in /mutemode command:", { error });
      await interaction.reply({ content: "⚠️ An error occurred while toggling mute mode. Please try again later.", ephemeral: true });
    }
  }
};
