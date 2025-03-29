const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue } = require('../utils/database');

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
    )
    .setDefaultMemberPermissions(PermissionsBitField.Administrator),
    
  /**
   * Executes the /mutemode command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
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
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", flags: MessageFlags.Ephemeral });
    }
  }
};
