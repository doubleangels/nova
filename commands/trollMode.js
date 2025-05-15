const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue, getValue } = require('../utils/database');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We use these configuration constants for the troll mode feature.
const TROLL_MODE_ENABLED_KEY = 'troll_mode_enabled';
const TROLL_MODE_ACCOUNT_AGE_KEY = 'troll_mode_account_age';
const DEFAULT_TROLL_MODE_AGE_DAYS = 30;
const MIN_ACCOUNT_AGE = 1;
const MAX_ACCOUNT_AGE = 365; // We set a maximum of 1 year to prevent unreasonable values.

/**
 * We handle the trollmode command.
 * This function allows administrators to manage auto-kicking of accounts based on age.
 *
 * We perform several tasks:
 * 1. Configure troll mode settings (enable/disable)
 * 2. Set minimum account age requirements
 * 3. Display current troll mode status
 * 4. Handle database operations for settings
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('trollmode')
    .setDescription('Manage auto-kicking of accounts younger than a specified age.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Configure troll mode settings.')
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
            .setDescription(`Minimum account age in days (Default: ${DEFAULT_TROLL_MODE_AGE_DAYS})`)
            .setRequired(false)
            .setMinValue(MIN_ACCOUNT_AGE)
            .setMaxValue(MAX_ACCOUNT_AGE)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current troll mode settings.')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    
  /**
   * Executes the trollmode command to manage account-age-based kicking.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // We defer the reply to allow time for database operations to complete.
      await interaction.deferReply();
      
      const subcommand = interaction.options.getSubcommand();
      logger.info("Trollmode command received.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId,
        subcommand
      });
      
      if (subcommand === 'set') {
        await this.handleSetTrollMode(interaction);
      } else if (subcommand === 'status') {
        await this.handleTrollModeStatus(interaction);
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Handles the 'set' subcommand to configure troll mode settings.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async handleSetTrollMode(interaction) {
    // We retrieve the command options provided by the user.
    const enabledInput = interaction.options.getString('enabled');
    const age = interaction.options.getInteger('age') ?? DEFAULT_TROLL_MODE_AGE_DAYS;
    const isEnabled = enabledInput.toLowerCase() === 'enabled';
    
    logger.debug("Parsed trollmode command parameters.", {
      isEnabled,
      age,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
      
    // We validate the age parameter is within acceptable bounds.
    if (age < MIN_ACCOUNT_AGE || age > MAX_ACCOUNT_AGE) {
      logger.warn("Invalid age parameter for trollmode.", {
        age,
        userId: interaction.user.id,
        min: MIN_ACCOUNT_AGE,
        max: MAX_ACCOUNT_AGE
      });
      await interaction.editReply({
        content: ERROR_MESSAGES.TROLLMODE_INVALID_AGE,
        ephemeral: true
      });
      return;
    }

    // We get current settings for comparison to show what changed.
    const currentSettings = await this.getCurrentSettings();
    
    // We save the troll mode settings in the database.
    try {
      await Promise.all([
        setValue(TROLL_MODE_ENABLED_KEY, isEnabled),
        setValue(TROLL_MODE_ACCOUNT_AGE_KEY, age)
      ]);
      
      logger.debug("Trollmode settings saved to database.", {
        isEnabled,
        age,
        enabledKey: TROLL_MODE_ENABLED_KEY,
        ageKey: TROLL_MODE_ACCOUNT_AGE_KEY
      });
    } catch (dbError) {
      throw new Error("DATABASE_WRITE_ERROR");
    }

    // We prepare a user-friendly response message highlighting the changes.
    const responseMessage = this.formatUpdateMessage(
      currentSettings.isEnabled, isEnabled,
      currentSettings.age, age
    );

    // We reply to the interaction with the update confirmation.
    await interaction.editReply(responseMessage);
    
    logger.info("Trollmode settings updated successfully.", {
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      guildId: interaction.guildId,
      previousEnabled: currentSettings.isEnabled,
      newEnabled: isEnabled,
      previousAge: currentSettings.age,
      newAge: age
    });
  },
  
  /**
   * Handles the 'status' subcommand to check current troll mode settings.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async handleTrollModeStatus(interaction) {
    try {
      // We retrieve the current settings from the database.
      const settings = await this.getCurrentSettings();
      
      // We format a user-friendly status message with the current settings.
      const statusMessage = this.formatStatusMessage(settings);
      
      await interaction.editReply(statusMessage);
      
      logger.info("Trollmode status check completed successfully.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guildId,
        isEnabled: settings.isEnabled,
        age: settings.age
      });
    } catch (dbError) {
      logger.error("Database operation failed while retrieving trollmode settings.", { 
        error: dbError.message, 
        stack: dbError.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      throw new Error("DATABASE_READ_ERROR");
    }
  },
  
  /**
   * Gets the current troll mode settings from the database.
   * 
   * @returns {Promise<Object>} The current settings.
   */
  async getCurrentSettings() {
    try {
      // We retrieve both settings in parallel for efficiency.
      const [isEnabled, age] = await Promise.all([
        getValue(TROLL_MODE_ENABLED_KEY),
        getValue(TROLL_MODE_ACCOUNT_AGE_KEY)
      ]);
      
      return {
        isEnabled: isEnabled === true, // We ensure this is a boolean value.
        age: age ? Number(age) : DEFAULT_TROLL_MODE_AGE_DAYS
      };
    } catch (error) {
      logger.error("Failed to retrieve current troll mode settings.", {
        error: error.message,
        stack: error.stack
      });

      throw new Error("DATABASE_READ_ERROR");
    }
  },
  
  /**
   * Formats an update message based on the old and new settings.
   * 
   * @param {boolean} oldEnabled - The previous enabled state.
   * @param {boolean} newEnabled - The new enabled state.
   * @param {number} oldAge - The previous age setting.
   * @param {number} newAge - The new age setting.
   * @returns {string} The formatted update message.
   */
  formatUpdateMessage(oldEnabled, newEnabled, oldAge, newAge) {
    let message = `👹 **Troll Mode Updated**\n\n`;
    
    // We display the current status with an appropriate emoji.
    const statusEmoji = newEnabled ? "✅" : "❌";
    const statusText = newEnabled ? "Enabled" : "Disabled";
    message += `• Status: ${statusEmoji} **${statusText}**\n`;
    
    // We show the age change if it was modified.
    if (oldAge !== newAge) {
      message += `• Minimum Account Age: **${oldAge}** → **${newAge}** days\n`;
    } else {
      message += `• Minimum Account Age: **${newAge}** days\n`;
    }
    
    if (newEnabled) {
      message += `\nAccounts younger than **${newAge}** days will be automatically kicked.`;
    }
    
    return message;
  },
  
  /**
   * Formats a status message based on the current settings.
   * 
   * @param {Object} settings - The current troll mode settings.
   * @returns {string} The formatted status message.
   */
  formatStatusMessage(settings) {
    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "Enabled" : "Disabled";
    
    let message = `👹 **Troll Mode Status**\n\n`;
    message += `• Status: ${statusEmoji} **${statusText}**\n`;
    message += `• Minimum Account Age: **${settings.age}** days`;
    
    if (settings.isEnabled) {
      message += `\n\nAccounts younger than **${settings.age}** days will be automatically kicked.`;
    }
    
    return message;
  },
  
  /**
   * Handles errors that occur during command execution.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'trollmode', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_READ_ERROR;
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_WRITE_ERROR;
    } else if (error.message === "INVALID_AGE") {
      errorMessage = ERROR_MESSAGES.TROLLMODE_INVALID_AGE;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for trollmode command.", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // Silent catch if everything fails.
      });
    }
  }
};