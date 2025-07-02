const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

/**
 * Command module for managing server-wide troll mode settings.
 * Controls automatic kicking of new members based on account age.
 * @type {Object}
 */
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
            .setDescription('What is the minimum account age allowed to join the server? (1-365)')
            .setMinValue(1)
            .setMaxValue(365)
            .setRequired(false)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
  /**
   * Executes the trollmode command.
   * This function:
   * 1. Processes the subcommand (status or set)
   * 2. Handles status checking or settings update
   * 3. Manages any errors that occur
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the command
   * @returns {Promise<void>}
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
   * Handles the status subcommand.
   * This function:
   * 1. Gets current troll mode settings
   * 2. Displays status information
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error checking status
   * @returns {Promise<void>}
   */
  async handleStatusSubcommand(interaction) {
    const settings = await this.getCurrentSettings();
    const embed = this.formatStatusMessage(settings, interaction);
    
    await interaction.reply({ embeds: [embed] });
    
    logger.info("/trollmode command completed successfully:", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      enabled: settings.enabled
    });
  },
  
  /**
   * Handles the set subcommand.
   * This function:
   * 1. Gets new settings from options
   * 2. Updates troll mode configuration
   * 3. Displays confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error updating settings
   * @returns {Promise<void>}
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
    
    logger.info("/trollmode command completed successfully:", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      enabled,
      accountAge
    });
  },
  
  /**
   * Retrieves current troll mode settings from the database.
   * 
   * @returns {Promise<Object>} Object containing current settings
   * @throws {Error} If there's an error retrieving settings
   */
  async getCurrentSettings() {
    try {
      const [enabled, accountAge] = await Promise.all([
        getValue('troll_mode_enabled'),
        getValue('troll_mode_account_age')
      ]);
      
      return {
        enabled: enabled === true,
        accountAge: accountAge ? Number(accountAge) : 30
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
   * Updates troll mode settings in the database.
   * 
   * @param {Object} settings - The new settings to apply
   * @throws {Error} If there's an error updating settings
   * @returns {Promise<void>}
   */
  async updateSettings(settings) {
    try {
      const updates = [];
      
      if (settings.enabled !== undefined) {
        updates.push(setValue('troll_mode_enabled', settings.enabled));
      }
      
      if (settings.accountAge !== undefined) {
        updates.push(setValue('troll_mode_account_age', settings.accountAge));
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
   * Creates an embed message showing current troll mode status.
   * 
   * @param {Object} settings - The current troll mode settings
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {EmbedBuilder} The formatted embed message
   */
  formatStatusMessage(settings, interaction) {
    const embed = new EmbedBuilder()
      .setColor(settings.enabled ? 0x00FF00 : 0xFF0000)
      .setTitle('🎭 Troll Mode Status')
      .addFields(
        { name: 'Status', value: settings.enabled ? '✅ Enabled' : '❌ Disabled' },
        { name: 'Minimum Account Age', value: `${settings.accountAge} days` }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    return embed;
  },
  
  /**
   * Creates an embed message confirming settings update.
   * 
   * @param {boolean} enabled - Whether troll mode is enabled
   * @param {number|null} accountAge - The minimum account age requirement
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {EmbedBuilder} The formatted embed message
   */
  formatUpdateMessage(enabled, accountAge, interaction) {
    const embed = new EmbedBuilder()
      .setColor(enabled ? 0x00FF00 : 0xFF0000)
      .setTitle(`🎭 Troll Mode ${enabled ? 'Enabled' : 'Disabled'}`)
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
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in trollmode command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while managing troll mode settings.";
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = "⚠️ Failed to retrieve troll mode settings. Please try again later.";
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = "⚠️ Failed to update troll mode settings. Please try again later.";
    } else if (error.message === "PERMISSION_DENIED") {
      errorMessage = "⚠️ You don't have permission to manage troll mode settings.";
    } else if (error.message === "INVALID_SETTINGS") {
      errorMessage = "⚠️ Invalid troll mode settings provided.";
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
      }).catch(() => {});
    }
  }
};