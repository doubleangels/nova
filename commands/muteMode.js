const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue, isConnected } = require('../utils/database');

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'mutemode',
  DESCRIPTION: "Toggle auto-kicking of users who don't send a message within a time limit.",
  DEFAULT_TIME_LIMIT: 2, // Default time limit in hours
  MIN_TIME_LIMIT: 1, // Minimum allowed time limit in hours
  MAX_TIME_LIMIT: 72, // Maximum allowed time limit in hours (3 days)
  DB_KEYS: {
    ENABLED: "mute_mode_enabled",
    TIME_LIMIT: "mute_mode_kick_time_hours"
  },
  RESPONSES: {
    ENABLED_TPL: "🔇 Mute mode has been ✅ **enabled**. New users must send a message within **%d** hours or be kicked.",
    DISABLED: "🔇 Mute mode has been ⚠️ **disabled**.",
    ERROR: "⚠️ An unexpected error occurred. Please try again later.",
    DB_ERROR: "⚠️ Database connection error. Please check server logs.",
    INVALID_TIME: "⚠️ Invalid time limit. Please specify a value between %d and %d hours."
  }
};

/**
 * Module for the /mutemode command.
 * Toggles auto-kicking of users who don't send a message within a specified time limit.
 * Only users with Administrator permissions can execute this command.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_CONFIG.NAME)
    .setDescription(COMMAND_CONFIG.DESCRIPTION)
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
        .setDescription(`Time limit in hours before a silent user is kicked (Default: ${COMMAND_CONFIG.DEFAULT_TIME_LIMIT})`)
        .setRequired(false)
        .setMinValue(COMMAND_CONFIG.MIN_TIME_LIMIT)
        .setMaxValue(COMMAND_CONFIG.MAX_TIME_LIMIT)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the /mutemode command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {
      // Check database connection before proceeding.
      if (!isConnected()) {
        logger.error("Failed to execute mutemode command due to database connection issue.", {
          userId: interaction.user.id,
          guildId: interaction.guildId
        });
        
        return await interaction.editReply({
          content: COMMAND_CONFIG.RESPONSES.DB_ERROR,
          ephemeral: true
        });
      }
      
      logger.info("Mutemode command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Get the 'enabled' input.
      const enabledInput = interaction.options.getString('enabled');
      const isEnabled = enabledInput === 'enabled';
      
      // Get and validate the time limit.
      let timeLimit = interaction.options.getInteger('time') ?? COMMAND_CONFIG.DEFAULT_TIME_LIMIT;
      
      if (timeLimit < COMMAND_CONFIG.MIN_TIME_LIMIT || timeLimit > COMMAND_CONFIG.MAX_TIME_LIMIT) {
        logger.warn("Invalid time limit specified.", {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          providedValue: timeLimit
        });
        
        timeLimit = COMMAND_CONFIG.DEFAULT_TIME_LIMIT;
      }
      
      logger.debug("Processing mutemode command.", {
        isEnabled,
        timeLimit,
        guildId: interaction.guildId
      });

      // Update the settings in the database.
      await setValue(COMMAND_CONFIG.DB_KEYS.ENABLED, isEnabled);
      await setValue(COMMAND_CONFIG.DB_KEYS.TIME_LIMIT, timeLimit);

      // Prepare the response message based on the mode.
      const responseMessage = isEnabled 
        ? COMMAND_CONFIG.RESPONSES.ENABLED_TPL.replace('%d', timeLimit)
        : COMMAND_CONFIG.RESPONSES.DISABLED;

      // Reply to the interaction.
      await interaction.editReply(responseMessage);
      
      logger.info("Mutemode configuration updated successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        isEnabled,
        timeLimit
      });
      
    } catch (error) {
      logger.error("Error executing mutemode command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Handle case where interaction wasn't deferred properly.
      try {
        await interaction.editReply({
          content: COMMAND_CONFIG.RESPONSES.ERROR,
          ephemeral: true
        });
      } catch (followUpError) {
        logger.error("Failed to send error response for mutemode command.", {
          error: followUpError.message,
          originalError: error.message,
          userId: interaction.user.id
        });
        
        // Try replying if editing failed.
        await interaction.reply({
          content: COMMAND_CONFIG.RESPONSES.ERROR,
          ephemeral: true
        }).catch(() => {
          // Silent catch if everything fails.
        });
      }
    }
  }
};
