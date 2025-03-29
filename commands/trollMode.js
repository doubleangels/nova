const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue } = require('../utils/database');

/**
 * Module for the /trollmode command.
 * Toggles kicking of accounts younger than a specified age.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('trollmode')
    .setDescription('Toggle kicking of accounts younger than a specified age.')
    .addStringOption(option =>
      option
        .setName('enabled')
        .setDescription('Do you want to enable or disable troll mode?')
        .setRequired(true)
        .addChoices(
          { name: 'Enabled', value: 'enabled' },
          { name: 'Disabled', value: 'disabled' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('age')
        .setDescription('Minimum account age in days (Default: 30)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Administrator),
    
  /**
   * Executes the /trollmode command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      logger.debug("/trollmode command received:", { user: interaction.user.tag });
      
      // Retrieve the 'enabled' option and the account age threshold.
      const enabledInput = interaction.options.getString('enabled');
      const age = interaction.options.getInteger('age') ?? 30;
      const isEnabled = enabledInput.toLowerCase() === 'enabled';
      logger.debug("Parsed troll mode command:", { isEnabled, age });

      // Save the troll mode settings in the database.
      await setValue('troll_mode_enabled', isEnabled);
      await setValue('troll_mode_account_age', age);
      logger.debug("Troll mode settings saved:", { isEnabled, age });

      // Prepare the response message.
      const responseMessage = isEnabled
        ? `👹 Troll mode has been ✅ **enabled**. Minimum account age: **${age}** days.`
        : `👹 Troll mode has been ❌ **disabled**.`;

      // Reply to the interaction.
      await interaction.reply(responseMessage);
      logger.debug("Troll mode command executed:", { user: interaction.user.tag, isEnabled, age });
    } catch (error) {
      logger.error("Error in /trollmode command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", flags: MessageFlags.Ephemeral });
    }
  }
};
