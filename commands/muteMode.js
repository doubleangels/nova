const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue, getValue } = require('../utils/database');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We define configuration constants for the mute mode feature.
const DEFAULT_TIME_LIMIT = 2; // We set a default time limit of 2 hours before kicking inactive users.
const MIN_TIME_LIMIT = 1; // We set a minimum time limit of 1 hour to prevent abuse.
const MAX_TIME_LIMIT = 72; // We set a maximum time limit of 72 hours (3 days) for reasonable bounds.
const DB_KEY_ENABLED = "mute_mode_enabled";
const DB_KEY_TIME_LIMIT = "mute_mode_kick_time_hours";

/**
 * We handle the mutemode command.
 * This function allows administrators to manage auto-kicking of inactive users.
 *
 * We perform several tasks:
 * 1. We configure mute mode settings (enable/disable).
 * 2. We set time limits for user inactivity.
 * 3. We display current mute mode status.
 * 4. We handle database operations for settings.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('mutemode')
    .setDescription("Toggle auto-kicking of users who don't send a message within a time limit.")
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Configure mute mode settings.')
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
            .setDescription(`Time limit in hours before a silent user is kicked (${MIN_TIME_LIMIT}-${MAX_TIME_LIMIT})`)
            .setRequired(false)
            .setMinValue(MIN_TIME_LIMIT)
            .setMaxValue(MAX_TIME_LIMIT)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current mute mode status.')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  /**
   * We execute the /mutemode command.
   * This function processes the mute mode configuration request.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {      
      logger.info("Mutemode command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand: interaction.options.getSubcommand()
      });
      
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'status') {
        await this.handleStatusSubcommand(interaction);
      } else if (subcommand === 'set') {
        await this.handleSetSubcommand(interaction);
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * We handle the 'status' subcommand to show current mute mode settings.
   * This function retrieves and displays the current configuration.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleStatusSubcommand(interaction) {
    try {
      // We retrieve the current settings from the database.
      const currentSettings = await this.getCurrentSettings();
      
      // We format a user-friendly status message with the current settings.
      const statusMessage = this.formatStatusMessage(currentSettings);
      await interaction.editReply(statusMessage);
      
      logger.info("Mutemode status retrieved successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        settings: currentSettings
      });
    } catch (error) {
      throw error; // We propagate to the main error handler for consistent error handling.
    }
  },
  
  /**
   * We handle the 'set' subcommand to update mute mode settings.
   * This function processes and applies configuration changes.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleSetSubcommand(interaction) {
    try {
      // We get the current settings first as a reference point.
      const currentSettings = await this.getCurrentSettings();
      
      // We get the 'enabled' input from the command options.
      const enabledInput = interaction.options.getString('enabled');
      const isEnabled = enabledInput === 'enabled';
      
      // We get and validate the time limit, falling back to the current value if not provided.
      let timeLimit = interaction.options.getInteger('time') ?? currentSettings.timeLimit;
      
      if (timeLimit < MIN_TIME_LIMIT || timeLimit > MAX_TIME_LIMIT) {
        logger.warn("Invalid time limit specified:", {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          providedValue: timeLimit
        });
        
        timeLimit = DEFAULT_TIME_LIMIT;
      }
      
      logger.debug("Processing mutemode update:", {
        currentEnabled: currentSettings.isEnabled,
        newEnabled: isEnabled,
        currentTimeLimit: currentSettings.timeLimit,
        newTimeLimit: timeLimit,
        guildId: interaction.guildId
      });

      // We update the settings in the database with the new values.
      await this.updateSettings(isEnabled, timeLimit);

      // We prepare a user-friendly response message highlighting the changes.
      const responseMessage = this.formatUpdateMessage(
        currentSettings.isEnabled, isEnabled,
        currentSettings.timeLimit, timeLimit
      );

      // We reply to the interaction with the update confirmation.
      await interaction.editReply(responseMessage);
      
      logger.info("Mutemode configuration updated successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        isEnabled,
        timeLimit
      });
    } catch (error) {
      throw error; // We propagate to the main error handler for consistent error handling.
    }
  },
  
  /**
   * We get the current mute mode settings from the database.
   * This function retrieves the current configuration state.
   *
   * @returns {Promise<Object>} The current settings.
   */
  async getCurrentSettings() {
    try {
      // We retrieve both settings in parallel for efficiency.
      const [isEnabled, timeLimit] = await Promise.all([
        getValue(DB_KEY_ENABLED),
        getValue(DB_KEY_TIME_LIMIT)
      ]);
      
      return {
        isEnabled: isEnabled === true, // We ensure this is a boolean value.
        timeLimit: timeLimit ? Number(timeLimit) : DEFAULT_TIME_LIMIT
      };
    } catch (error) {
      logger.error("Failed to retrieve current mute mode settings:", {
        error: error.message,
        stack: error.stack
      });

      throw new Error("DATABASE_READ_ERROR");
    }
  },
  
  /**
   * We update the mute mode settings in the database.
   * This function persists configuration changes.
   *
   * @param {boolean} isEnabled - Whether mute mode is enabled.
   * @param {number} timeLimit - The time limit in hours.
   * @returns {Promise<void>}
   */
  async updateSettings(isEnabled, timeLimit) {
    try {
      // We update both settings in parallel for efficiency.
      await Promise.all([
        setValue(DB_KEY_ENABLED, isEnabled),
        setValue(DB_KEY_TIME_LIMIT, timeLimit)
      ]);
    } catch (error) {
      logger.error("Database operation failed during mute mode update:", { 
        error: error.message, 
        stack: error.stack
      });
      
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },
  
  /**
   * We format a status message based on the current settings.
   * This function creates a user-friendly display of the configuration.
   *
   * @param {Object} settings - The current mute mode settings.
   * @returns {string} The formatted status message.
   */
  formatStatusMessage(settings) {
    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "Enabled" : "Disabled";
    
    let message = `🔇 **Mute Mode Status**\n\n`;
    message += `• Status: ${statusEmoji} **${statusText}**\n`;
    message += `• Time Limit: **${settings.timeLimit}** hours`;
    
    if (settings.isEnabled) {
      message += `\n\nNew users must send a message within **${settings.timeLimit}** hours or they will be kicked.`;
    }
    
    return message;
  },
  
  /**
   * We format an update message based on the old and new settings.
   * This function creates a user-friendly display of configuration changes.
   *
   * @param {boolean} oldEnabled - The previous enabled state.
   * @param {boolean} newEnabled - The new enabled state.
   * @param {number} oldTimeLimit - The previous time limit.
   * @param {number} newTimeLimit - The new time limit.
   * @returns {string} The formatted update message.
   */
  formatUpdateMessage(oldEnabled, newEnabled, oldTimeLimit, newTimeLimit) {
    let message = `🔇 **Mute Mode Updated**\n\n`;
    
    // We display the current status with an appropriate emoji.
    const statusEmoji = newEnabled ? "✅" : "❌";
    const statusText = newEnabled ? "Enabled" : "Disabled";
    message += `• Status: ${statusEmoji} **${statusText}**\n`;
    
    // We show the time limit change if it was modified.
    if (oldTimeLimit !== newTimeLimit) {
      message += `• Time Limit: **${oldTimeLimit}** → **${newTimeLimit}** hours\n`;
    } else {
      message += `• Time Limit: **${newTimeLimit}** hours\n`;
    }
    
    if (newEnabled) {
      message += `\nNew users must send a message within **${newTimeLimit}** hours or they will be kicked.`;
    }
    
    return message;
  },
  
  /**
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'mutemode', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_READ_ERROR;
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_WRITE_ERROR;
    } else if (error.message === "INVALID_TIME_LIMIT") {
      errorMessage = ERROR_MESSAGES.MUTEMODE_INVALID_TIME;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for mutemode command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // We silently catch if all error handling attempts fail.
      });
    }
  }
};