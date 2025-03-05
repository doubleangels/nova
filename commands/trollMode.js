const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../logger')('trollMode.js');
const { setValue } = require('../utils/supabase');

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
    ),
    
  /**
   * Executes the /trollmode command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    // Check if the user has Administrator permissions.
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      logger.warn("Unauthorized /trollmode attempt:", { user: interaction.user.tag });
      await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      return;
    }

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
      await interaction.reply({ content: '⚠️ An error occurred while toggling troll mode. Please try again later.', ephemeral: true });
    }
  }
};
