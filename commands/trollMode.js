/**
 * Troll mode command module for managing server-wide troll mode settings.
 * Handles configuration updates, status checks, and permission validation.
 * @module commands/trollMode
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We define configuration constants for the troll mode feature.
const TROLL_MODE_ENABLED_KEY = 'troll_mode_enabled';
const TROLL_MODE_ACCOUNT_AGE_KEY = 'troll_mode_account_age';
const DEFAULT_TROLL_MODE_AGE_DAYS = 30;
const MIN_ACCOUNT_AGE = 1;
const MAX_ACCOUNT_AGE = 365; // We set a maximum of 1 year to prevent unreasonable values.

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trollmode')
    .setDescription('Manage server-wide troll mode settings.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current troll mode status.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set troll mode settings.')
        .addBooleanOption(option =>
          option
            .setName('enabled')
            .setDescription('Whether troll mode should be enabled')
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
  /**
   * Executes the troll mode command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the command execution fails
   */
  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      
      logger.info(`/trollmode ${subcommand} command initiated:`, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      switch (subcommand) {
        case 'status':
          await this.handleStatusSubcommand(interaction);
          break;
        case 'set':
          await this.handleSetSubcommand(interaction);
          break;
      }
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Handles the status subcommand to check current troll mode settings.
   * @async
   * @function handleStatusSubcommand
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   */
  async handleStatusSubcommand(interaction) {
    const settings = this.getCurrentSettings();
    const message = this.formatStatusMessage(settings);
    
    await interaction.reply({ content: message, ephemeral: true });
    
    logger.info("Troll mode status check completed.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      enabled: settings.enabled
    });
  },
  
  /**
   * Handles the set subcommand to update troll mode settings.
   * @async
   * @function handleSetSubcommand
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   */
  async handleSetSubcommand(interaction) {
    const enabled = interaction.options.getBoolean('enabled');
    
    await this.updateSettings({ enabled });
    const message = this.formatUpdateMessage(enabled);
    
    await interaction.reply({ content: message, ephemeral: true });
    
    logger.info("Troll mode settings updated.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      enabled
    });
  },
  
  /**
   * Retrieves the current troll mode settings.
   * @function getCurrentSettings
   * @returns {Object} The current troll mode settings
   */
  getCurrentSettings() {
    return {
      enabled: config.trollMode?.enabled ?? false
    };
  },
  
  /**
   * Updates the troll mode settings.
   * @function updateSettings
   * @param {Object} settings - The new settings to apply
   */
  updateSettings(settings) {
    if (!config.trollMode) {
      config.trollMode = {};
    }
    Object.assign(config.trollMode, settings);
  },
  
  /**
   * Formats a status message for the current troll mode settings.
   * @function formatStatusMessage
   * @param {Object} settings - The current troll mode settings
   * @returns {string} The formatted status message
   */
  formatStatusMessage(settings) {
    return `🎭 **Troll Mode Status**\n\n` +
           `• **Status**: ${settings.enabled ? 'Enabled' : 'Disabled'}`;
  },
  
  /**
   * Formats an update message for troll mode settings changes.
   * @function formatUpdateMessage
   * @param {boolean} enabled - Whether troll mode is enabled
   * @returns {string} The formatted update message
   */
  formatUpdateMessage(enabled) {
    return `🎭 **Troll Mode ${enabled ? 'Enabled' : 'Disabled'}**\n\n` +
           `Troll mode has been ${enabled ? 'enabled' : 'disabled'} for this server.`;
  },

  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'trollmode', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    const errorMessage = getErrorMessage(error);
    
    try {
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for troll mode command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
    }
  }
};