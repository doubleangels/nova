/**
 * Troll mode command module for managing server-wide troll mode settings.
 * Handles configuration updates, status checks, and permission validation.
 * @module commands/trollMode
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { logError } = require('../errors');
const { getValue, setValue } = require('../utils/database');

const TROLL_DB_KEY_ENABLED = 'troll_mode_enabled';
const TROLL_DB_KEY_ACCOUNT_AGE = 'troll_mode_account_age';

const TROLL_DEFAULT_AGE_DAYS = 30;
const TROLL_MIN_ACCOUNT_AGE = 1;
const TROLL_MAX_ACCOUNT_AGE = 365;

const TROLL_EMBED_COLOR_ENABLED = '#00FF00';
const TROLL_EMBED_COLOR_DISABLED = '#FF0000';
const TROLL_EMBED_TITLE_STATUS = '🎭 Troll Mode Status';
const TROLL_EMBED_TITLE_UPDATE = '🎭 Troll Mode %s';

const TROLL_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while managing troll mode settings.";
const TROLL_ERROR_DATABASE_READ = "⚠️ Failed to retrieve troll mode settings. Please try again later.";
const TROLL_ERROR_DATABASE_WRITE = "⚠️ Failed to update troll mode settings. Please try again later.";
const TROLL_ERROR_PERMISSION_DENIED = "⚠️ You don't have permission to manage troll mode settings.";
const TROLL_ERROR_INVALID_SETTINGS = "⚠️ Invalid troll mode settings provided.";
const TROLL_ERROR_SETTINGS_UPDATE = "⚠️ Failed to update troll mode settings.";
const TROLL_ERROR_SETTINGS_READ = "⚠️ Failed to read troll mode settings.";
const TROLL_ERROR_INVALID_USER = "⚠️ Invalid user specified.";
const TROLL_ERROR_USER_NOT_FOUND = "⚠️ The specified user could not be found.";
const TROLL_ERROR_INVALID_CHANNEL = "⚠️ Invalid channel specified.";
const TROLL_ERROR_CHANNEL_NOT_FOUND = "⚠️ The specified channel could not be found.";
const TROLL_ERROR_INVALID_ROLE = "⚠️ Invalid role specified.";
const TROLL_ERROR_ROLE_NOT_FOUND = "⚠️ The specified role could not be found.";

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
            .setDescription('Should troll mode be enabled?')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('age')
            .setDescription(`What is the minimum account age allowed to join the server? (${TROLL_MIN_ACCOUNT_AGE}-${TROLL_MAX_ACCOUNT_AGE})`)
            .setMinValue(TROLL_MIN_ACCOUNT_AGE)
            .setMaxValue(TROLL_MAX_ACCOUNT_AGE)
            .setRequired(false)
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
      
      logger.info(`/trollmode command initiated:`, {
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
    const settings = await this.getCurrentSettings();
    const embed = this.formatStatusMessage(settings, interaction);
    
    await interaction.reply({ embeds: [embed] });
    
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
    const accountAge = interaction.options.getInteger('age');
    
    const settings = { enabled };
    if (accountAge !== null) {
      settings.accountAge = accountAge;
    }
    
    await this.updateSettings(settings);
    const embed = this.formatUpdateMessage(enabled, accountAge, interaction);
    
    await interaction.reply({ embeds: [embed] });
    
    logger.info("Troll mode settings updated.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      enabled,
      accountAge
    });
  },
  
  /**
   * Retrieves the current troll mode settings.
   * @function getCurrentSettings
   * @returns {Object} The current troll mode settings
   */
  async getCurrentSettings() {
    try {
      const [enabled, accountAge] = await Promise.all([
        getValue(TROLL_DB_KEY_ENABLED),
        getValue(TROLL_DB_KEY_ACCOUNT_AGE)
      ]);
      
      return {
        enabled: enabled === true,
        accountAge: accountAge ? Number(accountAge) : TROLL_DEFAULT_AGE_DAYS
      };
    } catch (error) {
      logger.error("Failed to retrieve troll mode settings:", {
        error: error.message,
        stack: error.stack
      });
      throw new Error("DATABASE_READ_ERROR");
    }
  },
  
  /**
   * Updates the troll mode settings.
   * @function updateSettings
   * @param {Object} settings - The new settings to apply
   */
  async updateSettings(settings) {
    try {
      const updates = [];
      
      if (settings.enabled !== undefined) {
        updates.push(setValue(TROLL_DB_KEY_ENABLED, settings.enabled));
      }
      
      if (settings.accountAge !== undefined) {
        updates.push(setValue(TROLL_DB_KEY_ACCOUNT_AGE, settings.accountAge));
      }
      
      await Promise.all(updates);
    } catch (error) {
      logger.error("Failed to update troll mode settings:", {
        error: error.message,
        stack: error.stack,
        settings
      });
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },
  
  /**
   * Formats a status message for the current troll mode settings.
   * @function formatStatusMessage
   * @param {Object} settings - The current troll mode settings
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @returns {EmbedBuilder} The formatted status message
   */
  formatStatusMessage(settings, interaction) {
    const embed = new EmbedBuilder()
      .setColor(settings.enabled ? TROLL_EMBED_COLOR_ENABLED : TROLL_EMBED_COLOR_DISABLED)
      .setTitle(TROLL_EMBED_TITLE_STATUS)
      .addFields(
        { name: 'Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled' },
        { name: 'Minimum Account Age', value: `${settings.accountAge} days` }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    return embed;
  },
  
  /**
   * Formats an update message for troll mode settings changes.
   * @function formatUpdateMessage
   * @param {boolean} enabled - Whether troll mode is enabled
   * @param {number} accountAge - The current account age
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @returns {EmbedBuilder} The formatted update message
   */
  formatUpdateMessage(enabled, accountAge, interaction) {
    const embed = new EmbedBuilder()
      .setColor(enabled ? TROLL_EMBED_COLOR_ENABLED : TROLL_EMBED_COLOR_DISABLED)
      .setTitle(TROLL_EMBED_TITLE_UPDATE.replace('%s', enabled ? 'Enabled' : 'Disabled'))
      .setDescription(`Troll mode has been ${enabled ? 'enabled' : 'disabled'} for this server.`)
      .setFooter({ text: `Updated by ${interaction.user.tag}` })
      .setTimestamp();

    if (accountAge !== null) {
      embed.addFields({ 
        name: 'Minimum Account Age', 
        value: `${accountAge} days` 
      });
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
    logError(error, 'trollmode', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = TROLL_ERROR_UNEXPECTED;
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = TROLL_ERROR_DATABASE_READ;
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = TROLL_ERROR_DATABASE_WRITE;
    } else if (error.message === "PERMISSION_DENIED") {
      errorMessage = TROLL_ERROR_PERMISSION_DENIED;
    } else if (error.message === "INVALID_SETTINGS") {
      errorMessage = TROLL_ERROR_INVALID_SETTINGS;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for trollmode command:", {
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