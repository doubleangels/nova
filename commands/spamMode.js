const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

/**
 * Command module for managing server-wide spam mode settings.
 * Controls spam mode functionality.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('spammode')
    .setDescription('Manage server-wide spam mode settings.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current spam mode status.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set spam mode settings.')
        .addBooleanOption(option =>
          option
            .setName('enabled')
            .setDescription('Should spam mode be enabled?')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('threshold')
            .setDescription('What is the minimum number of duplicate messages required to trigger spam mode? (2-10)')
            .setMinValue(2)
            .setMaxValue(10)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('window')
            .setDescription('How many hours to track duplicate messages? (1-72)')
            .setMinValue(1)
            .setMaxValue(72)
            .setRequired(false)
        )
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('What channel do you want to send spam warnings to?')
            .setRequired(false)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
  /**
   * Executes the spammode command.
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
    await interaction.deferReply();
    
    try {
      const subcommand = interaction.options.getSubcommand();
      
      logger.info(`/spammode command initiated.`, {
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
   * 1. Gets current spam mode settings
   * 2. Displays status information
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error checking status
   * @returns {Promise<void>}
   */
  async handleStatusSubcommand(interaction) {
    const settings = await this.getCurrentSettings();
    const embed = this.formatStatusMessage(settings, interaction);
    
    await interaction.editReply({ embeds: [embed] });
    
    logger.info("/spammode command completed successfully.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      enabled: settings.enabled
    });
  },
  
  /**
   * Handles the set subcommand.
   * This function:
   * 1. Gets new settings from options
   * 2. Updates spam mode configuration
   * 3. Displays confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error updating settings
   * @returns {Promise<void>}
   */
  async handleSetSubcommand(interaction) {
    const enabled = interaction.options.getBoolean('enabled');
    const threshold = interaction.options.getInteger('threshold');
    const window = interaction.options.getInteger('window');
    const warningChannel = interaction.options.getChannel('channel');
    
    const currentSettings = await this.getCurrentSettings();
    const settings = { enabled };
    if (threshold !== null) {
      settings.threshold = threshold;
    }
    if (window !== null) {
      settings.window = window;
    }
    if (warningChannel !== null) {
      settings.warningChannelId = warningChannel.id;
    }
    
    await this.updateSettings(settings);
    
    // Get the warning channel for display
    let displayWarningChannel = warningChannel;
    if (!displayWarningChannel && currentSettings.warningChannelId) {
      displayWarningChannel = interaction.guild?.channels.cache.get(currentSettings.warningChannelId);
    }
    
    const embed = this.formatUpdateMessage(
      enabled, 
      threshold ?? currentSettings.threshold,
      window ?? currentSettings.window,
      displayWarningChannel,
      interaction
    );
    
    await interaction.editReply({ embeds: [embed] });
    
    logger.info("/spammode command completed successfully.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      enabled,
      threshold: threshold ?? currentSettings.threshold,
      window: window ?? currentSettings.window,
      warningChannelId: warningChannel?.id ?? currentSettings.warningChannelId
    });
  },
  
  /**
   * Retrieves current spam mode settings from the database.
   * 
   * @returns {Promise<Object>} Object containing current settings
   * @throws {Error} If there's an error retrieving settings
   */
  async getCurrentSettings() {
    try {
      // Fetch all values in parallel, including mute_mode_kick_time_hours for potential default
      const [enabled, threshold, window, warningChannelId, muteKickTime] = await Promise.all([
        getValue('spam_mode_enabled'),
        getValue('spam_mode_threshold'),
        getValue('spam_mode_window_hours'),
        getValue('spam_mode_channel_id'),
        getValue('mute_mode_kick_time_hours')
      ]);
      
      // Default window to mute mode kick time if not set
      let defaultWindow = 4;
      if (muteKickTime) {
        defaultWindow = parseInt(muteKickTime, 10) || 4;
      }
      
      return {
        enabled: enabled === true,
        threshold: threshold ? parseInt(threshold, 10) : 3,
        window: window ? parseInt(window, 10) : defaultWindow,
        warningChannelId: warningChannelId || null
      };
    } catch (error) {
      logger.error("Failed to retrieve spam mode settings.", {
        err: error
      });
      throw new Error("DATABASE_READ_ERROR");
    }
  },
  
  /**
   * Updates spam mode settings in the database.
   * 
   * @param {Object} settings - The new settings to apply
   * @throws {Error} If there's an error updating settings
   * @returns {Promise<void>}
   */
  async updateSettings(settings) {
    try {
      const updates = [];
      
      if (settings.enabled !== undefined) {
        updates.push(setValue('spam_mode_enabled', settings.enabled));
      }
      
      if (settings.threshold !== undefined) {
        updates.push(setValue('spam_mode_threshold', settings.threshold));
      }
      
      if (settings.window !== undefined) {
        updates.push(setValue('spam_mode_window_hours', settings.window));
      }
      
      if (settings.warningChannelId !== undefined) {
        if (settings.warningChannelId) {
          updates.push(setValue('spam_mode_channel_id', settings.warningChannelId));
        } else {
          // If null/empty, remove the setting
          updates.push(setValue('spam_mode_channel_id', null));
        }
      }
      
      await Promise.all(updates);
    } catch (error) {
      logger.error("Failed to update spam mode settings.", {
        err: error,
        settings
      });
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },
  
  /**
   * Creates an embed message showing current spam mode status.
   * 
   * @param {Object} settings - The current spam mode settings
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {EmbedBuilder} The formatted embed message
   */
  formatStatusMessage(settings, interaction) {
    const embed = new EmbedBuilder()
      .setColor(settings.enabled ? 0x00FF00 : 0xFF0000)
      .setTitle('Spam Mode Status');

    const statusText = settings.enabled ? "Enabled" : "Disabled";
    
    embed.addFields(
      { name: 'Status', value: `**${statusText}**` },
      { name: 'Message Threshold', value: `${settings.threshold} duplicate messages` },
      { name: 'Tracking Window', value: `${settings.window} ${settings.window === 1 ? 'hour' : 'hours'}` }
    );
    
    if (settings.warningChannelId) {
      const warningChannel = interaction.guild?.channels.cache.get(settings.warningChannelId);
      embed.addFields({
        name: 'Warning Channel',
        value: warningChannel ? `${warningChannel}` : `<#${settings.warningChannelId}>`
      });
    } else {
      embed.addFields({
        name: 'Warning Channel',
        value: '⚠️ Not configured'
      });
    }
    
    if (settings.enabled) {
      if (!settings.warningChannelId) {
        embed.setDescription('⚠️ Spam configuration is incomplete. ');
      } else {
        const hourText = settings.window === 1 ? 'hour' : 'hours';
        embed.setDescription(`New users sending **${settings.threshold}** or more duplicate messages within **${settings.window}** ${hourText} will have their messages deleted and a warning posted.\n\n*Note: Bot accounts are exempt from this tracking.*`);
      }
    }

    return embed;
  },

  /**
   * Creates an embed message confirming settings update.
   * 
   * @param {boolean} enabled - Whether spam mode is enabled
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {EmbedBuilder} The formatted embed message
   */
  formatUpdateMessage(enabled, threshold, window, warningChannel, interaction) {
    const embed = new EmbedBuilder()
      .setColor(enabled ? 0x00FF00 : 0xFF0000)
      .setTitle(`Spam Mode ${enabled ? 'Enabled' : 'Disabled'}`);

    const statusText = enabled ? "Enabled" : "Disabled";
    
    embed.addFields(
      { name: 'Status', value: `**${statusText}**` },
      { name: 'Message Threshold', value: `${threshold} duplicate messages` },
      { name: 'Tracking Window', value: `${window} ${window === 1 ? 'hour' : 'hours'}` }
    );
    
    if (warningChannel) {
      embed.addFields({
        name: 'Warning Channel',
        value: `${warningChannel}`
      });
    } else {
      embed.addFields({
        name: 'Warning Channel',
        value: '⚠️ Not configured'
      });
    }
    
    if (enabled) {
      if (!warningChannel) {
        embed.setDescription('⚠️ Spam configuration is incomplete. ');
      } else {
        const hourText = window === 1 ? 'hour' : 'hours';
        embed.setDescription(`New users sending **${threshold}** or more duplicate messages within **${window}** ${hourText} will have their messages deleted and a warning posted.\n\n*Note: Bot accounts are exempt from this tracking.*`);
      }
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
    logger.error("Error occurred in spammode command.", {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while managing spam mode settings.";
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = "⚠️ Failed to retrieve spam mode settings. Please try again later.";
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = "⚠️ Failed to update spam mode settings. Please try again later.";
    } else if (error.message === "PERMISSION_DENIED") {
      errorMessage = "⚠️ You don't have permission to manage spam mode settings.";
    } else if (error.message === "INVALID_SETTINGS") {
      errorMessage = "⚠️ Invalid spam mode settings provided.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for spammode command.", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  }
};

