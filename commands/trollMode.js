const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue } = require('../utils/supabase');

/**
 * Module for the /trollmode command.
 * This command toggles kicking of accounts younger than a specified age.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('trollmode')
    .setDescription('Toggle kicking of accounts younger than a specified age.')
    .addStringOption(option =>
      option
        .setName('enabled')
        .setDescription('Enable or disable troll mode')
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
      logger.warn(`Unauthorized /trollmode attempt by ${interaction.user.tag}`);
      await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      return;
    }

    try {
      logger.debug(`/trollmode command received from ${interaction.user.tag}`);
      
      // Retrieve the 'enabled' option and the account age threshold.
      const enabledInput = interaction.options.getString('enabled');
      const age = interaction.options.getInteger('age') ?? 30;
      // Determine if troll mode should be enabled.
      const isEnabled = enabledInput.toLowerCase() === 'enabled';

      logger.debug(`Troll mode toggle: ${isEnabled ? 'Enabled' : 'Disabled'}, Minimum age: ${age} days`);

      // Save the troll mode settings in the database.
      await setValue('troll_mode_enabled', isEnabled);
      await setValue('troll_mode_account_age', age);

      // Prepare the response message based on the mode.
      const responseMessage = isEnabled
        ? `👹 Troll mode has been ✅ **enabled**. Minimum account age: **${age}** days.`
        : `👹 Troll mode has been ❌ **disabled**.`;

      // Reply to the interaction with the confirmation message.
      await interaction.reply(responseMessage);
      logger.debug(`Troll mode ${isEnabled ? 'enabled' : 'disabled'} by ${interaction.user.tag}; account age threshold = ${age} days.`);
    } catch (e) {
      // Log any errors and notify the user.
      logger.error(`Error in /trollmode command: ${e}`);
      await interaction.reply({ content: '⚠️ An error occurred while toggling troll mode. Please try again later.', ephemeral: true });
    }
  }
};
