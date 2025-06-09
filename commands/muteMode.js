/**
 * Mute mode command module for managing auto-kicking of inactive users.
 * Handles configuration, time limits, and status updates.
 * @module commands/muteMode
 */

const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { setValue, getValue } = require('../utils/database');
const { logError } = require('../errors');

const MUTE_DB_KEY_ENABLED = "mute_mode_enabled";
const MUTE_DB_KEY_TIME_LIMIT = "mute_mode_kick_time_hours";

const MUTE_DEFAULT_TIME_LIMIT = 2;
const MUTE_MIN_TIME_LIMIT = 1;
const MUTE_MAX_TIME_LIMIT = 72;

const MUTE_EMBED_COLOR_ENABLED = '#00FF00';
const MUTE_EMBED_COLOR_DISABLED = '#FF0000';
const MUTE_EMBED_TITLE_STATUS = '🔇 Mute Mode Status';
const MUTE_EMBED_TITLE_UPDATE = '🔇 Mute Mode Updated';

const MUTE_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while managing mute mode.";
const MUTE_ERROR_DATABASE_READ = "⚠️ Failed to retrieve mute mode settings. Please try again later.";
const MUTE_ERROR_DATABASE_WRITE = "⚠️ Failed to update mute mode settings. Please try again later.";
const MUTE_ERROR_INVALID_TIME = "⚠️ Invalid time limit specified. Using default value.";
const MUTE_ERROR_UPDATE_FAILED = "⚠️ Failed to update mute mode.";
const MUTE_ERROR_QUERY_FAILED = "⚠️ Failed to query mute mode.";
const MUTE_ERROR_TOGGLE_FAILED = "⚠️ Failed to toggle mute mode.";

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
            .setDescription(`Time limit in hours before a silent user is kicked (${MUTE_MIN_TIME_LIMIT}-${MUTE_MAX_TIME_LIMIT})`)
            .setRequired(false)
            .setMinValue(MUTE_MIN_TIME_LIMIT)
            .setMaxValue(MUTE_MAX_TIME_LIMIT)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current mute mode status.')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  /**
   * Executes the mute mode command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the command execution fails
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
   * Handles the 'status' subcommand to show current mute mode settings.
   * @async
   * @function handleStatusSubcommand
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If retrieving settings fails
   */
  async handleStatusSubcommand(interaction) {
    try {
      const currentSettings = await this.getCurrentSettings();
      
      const embed = this.formatStatusMessage(currentSettings);
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Mutemode status retrieved successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        settings: currentSettings
      });
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Handles the 'set' subcommand to update mute mode settings.
   * @async
   * @function handleSetSubcommand
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If updating settings fails
   */
  async handleSetSubcommand(interaction) {
    try {
      const currentSettings = await this.getCurrentSettings();
      
      const enabledInput = interaction.options.getString('enabled');
      const isEnabled = enabledInput === 'enabled';
      
      let timeLimit = interaction.options.getInteger('time') ?? currentSettings.timeLimit;
      
      if (timeLimit < MUTE_MIN_TIME_LIMIT || timeLimit > MUTE_MAX_TIME_LIMIT) {
        logger.warn("Invalid time limit specified:", {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          providedValue: timeLimit
        });
        
        timeLimit = MUTE_DEFAULT_TIME_LIMIT;
      }
      
      logger.debug("Processing mutemode update:", {
        currentEnabled: currentSettings.isEnabled,
        newEnabled: isEnabled,
        currentTimeLimit: currentSettings.timeLimit,
        newTimeLimit: timeLimit,
        guildId: interaction.guildId
      });

      await this.updateSettings(isEnabled, timeLimit);

      const embed = this.formatUpdateMessage(
        currentSettings.isEnabled, isEnabled,
        currentSettings.timeLimit, timeLimit
      );

      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Mutemode configuration updated successfully:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        isEnabled,
        timeLimit
      });
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Gets the current mute mode settings from the database.
   * @async
   * @function getCurrentSettings
   * @returns {Promise<Object>} The current settings
   * @throws {Error} If database read fails
   */
  async getCurrentSettings() {
    try {
      const [isEnabled, timeLimit] = await Promise.all([
        getValue(MUTE_DB_KEY_ENABLED),
        getValue(MUTE_DB_KEY_TIME_LIMIT)
      ]);
      
      return {
        isEnabled: isEnabled === true,
        timeLimit: timeLimit ? Number(timeLimit) : MUTE_DEFAULT_TIME_LIMIT
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
   * Updates the mute mode settings in the database.
   * @async
   * @function updateSettings
   * @param {boolean} isEnabled - Whether mute mode is enabled
   * @param {number} timeLimit - The time limit in hours
   * @throws {Error} If database write fails
   */
  async updateSettings(isEnabled, timeLimit) {
    try {
      await Promise.all([
        setValue(MUTE_DB_KEY_ENABLED, isEnabled),
        setValue(MUTE_DB_KEY_TIME_LIMIT, timeLimit)
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
   * Formats a status message based on the current settings.
   * @function formatStatusMessage
   * @param {Object} settings - The current mute mode settings
   * @returns {EmbedBuilder} The formatted status message
   */
  formatStatusMessage(settings) {
    const embed = new EmbedBuilder()
      .setColor(settings.isEnabled ? MUTE_EMBED_COLOR_ENABLED : MUTE_EMBED_COLOR_DISABLED)
      .setTitle(MUTE_EMBED_TITLE_STATUS)
      .setTimestamp();

    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "Enabled" : "Disabled";
    
    embed.addFields(
      { name: 'Status', value: `${statusEmoji} **${statusText}**` },
      { name: 'Time Limit', value: `**${settings.timeLimit}** hours` }
    );
    
    if (settings.isEnabled) {
      embed.setDescription(`New users must send a message within **${settings.timeLimit}** hours or they will be kicked.`);
    }

    return embed;
  },
  
  /**
   * Formats an update message based on the old and new settings.
   * @function formatUpdateMessage
   * @param {boolean} oldEnabled - The previous enabled state
   * @param {boolean} newEnabled - The new enabled state
   * @param {number} oldTimeLimit - The previous time limit
   * @param {number} newTimeLimit - The new time limit
   * @returns {EmbedBuilder} The formatted update message
   */
  formatUpdateMessage(oldEnabled, newEnabled, oldTimeLimit, newTimeLimit) {
    const embed = new EmbedBuilder()
      .setColor(newEnabled ? MUTE_EMBED_COLOR_ENABLED : MUTE_EMBED_COLOR_DISABLED)
      .setTitle(MUTE_EMBED_TITLE_UPDATE)
      .setTimestamp();

    const statusEmoji = newEnabled ? "✅" : "❌";
    const statusText = newEnabled ? "Enabled" : "Disabled";
    
    embed.addFields(
      { name: 'Status', value: `${statusEmoji} **${statusText}**` }
    );
    
    if (oldTimeLimit !== newTimeLimit) {
      embed.addFields({ 
        name: 'Time Limit', 
        value: `**${oldTimeLimit}** → **${newTimeLimit}** hours` 
      });
    } else {
      embed.addFields({ 
        name: 'Time Limit', 
        value: `**${newTimeLimit}** hours` 
      });
    }
    
    if (newEnabled) {
      embed.setDescription(`New users must send a message within **${newTimeLimit}** hours or they will be kicked.`);
    }

    return embed;
  },
  
  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'mutemode', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = MUTE_ERROR_UNEXPECTED;
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = MUTE_ERROR_DATABASE_READ;
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = MUTE_ERROR_DATABASE_WRITE;
    } else if (error.message === "INVALID_TIME_LIMIT") {
      errorMessage = MUTE_ERROR_INVALID_TIME;
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
      });
    }
  }
};