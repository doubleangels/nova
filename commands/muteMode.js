const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue } = require('../utils/database');

// Configuration constants
const DEFAULT_TIME_LIMIT = 2; // Default time limit in hours
const MIN_TIME_LIMIT = 1; // Minimum allowed time limit in hours
const MAX_TIME_LIMIT = 72; // Maximum allowed time limit in hours (3 days)
const DB_KEY_ENABLED = "mute_mode_enabled";
const DB_KEY_TIME_LIMIT = "mute_mode_kick_time_hours";

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
        .setDescription(`Time limit in hours before a silent user is kicked (Default: ${DEFAULT_TIME_LIMIT})`)
        .setRequired(false)
        .setMinValue(MIN_TIME_LIMIT)
        .setMaxValue(MAX_TIME_LIMIT)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the /mutemode command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {      
      logger.info("Mutemode command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Get the 'enabled' input.
      const enabledInput = interaction.options.getString('enabled');
      const isEnabled = enabledInput === 'enabled';
      
      // Get and validate the time limit.
      let timeLimit = interaction.options.getInteger('time') ?? DEFAULT_TIME_LIMIT;
      
      if (timeLimit < MIN_TIME_LIMIT || timeLimit > MAX_TIME_LIMIT) {
        logger.warn("Invalid time limit specified.", {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          providedValue: timeLimit
        });
        
        timeLimit = DEFAULT_TIME_LIMIT;
      }
      
      logger.debug("Processing mutemode command.", {
        isEnabled,
        timeLimit,
        guildId: interaction.guildId
      });

      // Update the settings in the database.
      try {
        await setValue(DB_KEY_ENABLED, isEnabled);
        await setValue(DB_KEY_TIME_LIMIT, timeLimit);
      } catch (dbError) {
        logger.error("Database operation failed during mute mode update.", { 
          error: dbError.message, 
          stack: dbError.stack,
          userId: interaction.user.id,
          guildId: interaction.guildId
        });
        await interaction.editReply({
          content: "⚠️ Failed to save settings. Please try again later.",
          ephemeral: true
        });
        return;
      }

      // Prepare the response message based on the mode.
      const responseMessage = isEnabled 
        ? `🔇 Mute mode has been ✅ **enabled**. New users must send a message within **${timeLimit}** hours or be kicked.`
        : "🔇 Mute mode has been ⚠️ **disabled**.";

      // Reply to the interaction.
      await interaction.editReply(responseMessage);
      
      logger.info("Mutemode configuration updated successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        isEnabled,
        timeLimit
      });
      
    } catch (error) {
      logger.error("Error in /mutemode command execution.", { 
        error: error.message, 
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guildId
      });
      
      // Handle case where interaction wasn't deferred properly.
      try {
        await interaction.editReply({
          content: "⚠️ An unexpected error occurred. Please try again later.",
          ephemeral: true
        });
      } catch (followUpError) {
        logger.error("Failed to send error response for mutemode command.", {
          error: followUpError.message,
          originalError: error.message,
          userId: interaction.user?.id
        });
        
        // Try replying if editing failed.
        await interaction.reply({
          content: "⚠️ An unexpected error occurred. Please try again later.",
          ephemeral: true
        }).catch(() => {
          // Silent catch if everything fails.
        });
      }
    }
  }
};
