const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue } = require('../utils/database');

// Configuration constants.
const TROLL_MODE_ENABLED_KEY = 'troll_mode_enabled';
const TROLL_MODE_ACCOUNT_AGE_KEY = 'troll_mode_account_age';
const DEFAULT_TROLL_MODE_AGE_DAYS = 30;

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
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the trollmode command to toggle account-age-based kicking.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Verify the user has administrator permissions.
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        logger.warn("Unauthorized trollmode command attempt.", {
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          guildId: interaction.guildId
        });
        
        await interaction.reply({
          content: "⚠️ You need Administrator permissions to use this command.",
          ephemeral: true
        });
        return;
      }
      
      // Defer the reply to allow time for database operations.
      await interaction.deferReply();
      
      logger.info("Trollmode command received.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId
      });
      
      // Retrieve the command options.
      const enabledInput = interaction.options.getString('enabled');
      const age = interaction.options.getInteger('age') ?? DEFAULT_TROLL_MODE_AGE_DAYS;
      const isEnabled = enabledInput.toLowerCase() === 'enabled';
      
      logger.debug("Parsed trollmode command parameters.", {
        isEnabled,
        age,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Validate the age parameter.
      if (age <= 0) {
        logger.warn("Invalid age parameter for trollmode.", {
          age,
          userId: interaction.user.id
        });
        
        await interaction.editReply({
          content: "⚠️ Age must be a positive number of days."
        });
        return;
      }

      // Save the troll mode settings in the database.
      try {
        await setValue(TROLL_MODE_ENABLED_KEY, isEnabled);
        await setValue(TROLL_MODE_ACCOUNT_AGE_KEY, age);
        
        logger.debug("Trollmode settings saved to database.", {
          isEnabled,
          age,
          enabledKey: TROLL_MODE_ENABLED_KEY,
          ageKey: TROLL_MODE_ACCOUNT_AGE_KEY
        });
      } catch (dbError) {
        logger.error("Database operation failed while saving trollmode settings.", { 
          error: dbError.message, 
          stack: dbError.stack,
          userId: interaction.user.id,
          guildId: interaction.guildId
        });
        await interaction.editReply({
          content: "⚠️ Failed to save trollmode settings. Please try again later.",
          ephemeral: true
        });
        return;
      }

      // Prepare the response message.
      const responseMessage = isEnabled
        ? `👹 Troll mode has been ✅ **enabled**. Minimum account age: **${age}** days.`
        : '👹 Troll mode has been ❌ **disabled**.';

      // Reply to the interaction.
      await interaction.editReply(responseMessage);
      
      logger.info("Trollmode command executed successfully.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId,
        isEnabled,
        age
      });
      
    } catch (error) {
      logger.error("Error executing trollmode command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // If the reply hasn't been sent yet, send it. Otherwise, edit it.
      if (interaction.deferred) {
        await interaction.editReply({
          content: '⚠️ An unexpected error occurred. Please try again later.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '⚠️ An unexpected error occurred. Please try again later.',
          ephemeral: true
        });
      }
    }
  }
};
