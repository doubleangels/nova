const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue, getValue } = require('../utils/database');

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
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Configure mute mode settings')
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
        .setDescription('Check the current mute mode status')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  /**
   * Executes the /mutemode command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    await interaction.deferReply();
    
    try {      
      logger.info("Mutemode command initiated.", {
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
   * Handles the 'status' subcommand to show current mute mode settings.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleStatusSubcommand(interaction) {
    try {
      const currentSettings = await this.getCurrentSettings();
      
      const statusMessage = this.formatStatusMessage(currentSettings);
      await interaction.editReply(statusMessage);
      
      logger.info("Mutemode status retrieved successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        settings: currentSettings
      });
    } catch (error) {
      logger.error("Error retrieving mute mode status.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
        
      throw error; // Propagate to main error handler
    }
  },
  
  /**
   * Handles the 'set' subcommand to update mute mode settings.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleSetSubcommand(interaction) {
    try {
      // Get current settings first
      const currentSettings = await this.getCurrentSettings();
      
      // Get the 'enabled' input
      const enabledInput = interaction.options.getString('enabled');
      const isEnabled = enabledInput === 'enabled';
      
      // Get and validate the time limit
      let timeLimit = interaction.options.getInteger('time') ?? currentSettings.timeLimit;
      
      if (timeLimit < MIN_TIME_LIMIT || timeLimit > MAX_TIME_LIMIT) {
        logger.warn("Invalid time limit specified.", {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          providedValue: timeLimit
        });
        
        timeLimit = DEFAULT_TIME_LIMIT;
      }
      
      logger.debug("Processing mutemode update.", {
        currentEnabled: currentSettings.isEnabled,
        newEnabled: isEnabled,
        currentTimeLimit: currentSettings.timeLimit,
        newTimeLimit: timeLimit,
        guildId: interaction.guildId
      });

      // Update the settings in the database
      await this.updateSettings(isEnabled, timeLimit);

      // Prepare the response message
      const responseMessage = this.formatUpdateMessage(
        currentSettings.isEnabled, isEnabled,
        currentSettings.timeLimit, timeLimit
      );

      // Reply to the interaction
      await interaction.editReply(responseMessage);
      
      logger.info("Mutemode configuration updated successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        isEnabled,
        timeLimit
      });
    } catch (error) {
      logger.error("Error updating mute mode settings.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      throw error; // Propagate to main error handler
    }
  },
  
  /**
   * Gets the current mute mode settings from the database.
   * @returns {Promise<Object>} The current settings.
   */
  async getCurrentSettings() {
    try {
      const [isEnabled, timeLimit] = await Promise.all([
        getValue(DB_KEY_ENABLED),
        getValue(DB_KEY_TIME_LIMIT)
      ]);
      
      return {
        isEnabled: isEnabled === true, // Ensure boolean
        timeLimit: timeLimit ? Number(timeLimit) : DEFAULT_TIME_LIMIT
      };
    } catch (error) {
      logger.error("Failed to retrieve current mute mode settings.", {
        error: error.message,
        stack: error.stack
      });

      throw new Error("DATABASE_READ_ERROR");
    }
  },
  
  /**
   * Updates the mute mode settings in the database.
   * @param {boolean} isEnabled - Whether mute mode is enabled.
   * @param {number} timeLimit - The time limit in hours.
   * @returns {Promise<void>}
   */
  async updateSettings(isEnabled, timeLimit) {
    try {
      await Promise.all([
        setValue(DB_KEY_ENABLED, isEnabled),
        setValue(DB_KEY_TIME_LIMIT, timeLimit)
      ]);
    } catch (error) {
      logger.error("Database operation failed during mute mode update.", { 
        error: error.message, 
        stack: error.stack
      });
      
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },
  
  /**
   * Formats a status message based on the current settings.
   * @param {Object} settings - The current mute mode settings.
   * @returns {string} The formatted status message.
   */
  formatStatusMessage(settings) {
    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "enabled" : "disabled";
    
    let message = `🔇 **Mute Mode Status**\n\n`;
    message += `• Status: ${statusEmoji} **${statusText}**\n`;
    
    if (settings.isEnabled) {
      message += `• Time Limit: **${settings.timeLimit}** hours\n`;
      message += `\nNew users must send a message within **${settings.timeLimit}** hours or they will be kicked.`;
    }
    
    return message;
  },
  
  /**
   * Formats an update message based on the old and new settings.
   * @param {boolean} oldEnabled - The previous enabled state.
   * @param {boolean} newEnabled - The new enabled state.
   * @param {number} oldTimeLimit - The previous time limit.
   * @param {number} newTimeLimit - The new time limit.
   * @returns {string} The formatted update message.
   */
  formatUpdateMessage(oldEnabled, newEnabled, oldTimeLimit, newTimeLimit) {
    let message = `🔇 **Mute Mode Updated**\n\n`;
    
    // Status change
    if (oldEnabled !== newEnabled) {
      const statusEmoji = newEnabled ? "✅" : "❌";
      const statusText = newEnabled ? "enabled" : "disabled";
      message += `• Status: ${statusEmoji} **${statusText}**\n`;
    } else {
      const statusEmoji = newEnabled ? "✅" : "❌";
      const statusText = newEnabled ? "enabled" : "disabled";
      message += `• Status: ${statusEmoji} **${statusText}** (unchanged)\n`;
    }
    
    // Time limit change
    if (newEnabled) {
      if (oldTimeLimit !== newTimeLimit) {
        message += `• Time Limit: **${oldTimeLimit}** → **${newTimeLimit}** hours\n`;
      } else {
        message += `• Time Limit: **${newTimeLimit}** hours (unchanged)\n`;
      }
      
      message += `\nNew users must send a message within **${newTimeLimit}** hours or they will be kicked.`;
    }
    
    return message;
  },
  
  /**
   * Handles errors that occur during command execution.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logger.error("Error in /mutemode command execution.", { 
      error: error.message, 
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guildId
    });
    
    let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = "⚠️ Failed to retrieve current settings. Please try again later.";
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = "⚠️ Failed to save settings. Please try again later.";
    }
    
    // Handle case where interaction wasn't deferred properly
    try {
      await interaction.editReply({ content: errorMessage });
    } catch (followUpError) {
      logger.error("Failed to send error response for mutemode command.", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      // Try replying if editing failed
      await interaction.reply({ content: errorMessage })
        .catch(() => {
          // Silent catch if everything fails
        });
    }
  }
};