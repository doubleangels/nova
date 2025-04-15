const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

// Configuration constants.
const CONFIG_KEYS = {
  CHANNEL: "backup_mode_channel",
  ROLE: "backup_mode_role",
  ENABLED: "backup_mode_enabled"
};

/**
 * Module for the /backupmode command.
 * Configures and toggles backup mode for new members by setting:
 * - The channel to send welcome messages.
 * - The role to assign to new members.
 * - The auto-role assignment status.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('backupmode')
    .setDescription('Configure and toggle backup mode for new members.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Configure backup mode settings')
        .addStringOption(option =>
          option.setName('enabled')
            .setDescription('Do you want to enable or disable auto-role assignment?')
            .setRequired(false)
            .addChoices(
              { name: 'Enabled', value: 'enabled' },
              { name: 'Disabled', value: 'disabled' }
            )
        )
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('What channel do you want to send welcome messages to?')
            .setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role')
            .setDescription('What role to do you want to assign to new members?')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check the current backup mode configuration')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  /**
   * Executes the /backupmode command.
   * @param {ChatInputCommandInteraction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    await interaction.deferReply();
    try {
      logger.info("Backup mode command initiated.", { 
        userId: interaction.user.id, 
        guildId: interaction.guild.id,
        subcommand: interaction.options.getSubcommand()
      });
      
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'set') {
        await this.handleSetSubcommand(interaction);
      } else if (subcommand === 'status') {
        await this.handleStatusSubcommand(interaction);
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles the 'set' subcommand to update backup mode settings.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleSetSubcommand(interaction) {
    // Retrieve command options.
    const channelOption = interaction.options.getChannel('channel');
    const roleOption = interaction.options.getRole('role');
    const enabledOption = interaction.options.getString('enabled');
    // Validate inputs if provided
    const validationError = await this.validateInputs(interaction, channelOption, roleOption);
    if (validationError) {
      return;
    }
    
    // If any configuration option is provided, update settings
    if (channelOption || roleOption || enabledOption !== null) {
      // Get current settings for comparison
      const currentSettings = await this.getCurrentSettings();
      await this.updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption, currentSettings);
    } else {
      // No options provided: inform user
      await interaction.editReply({
        content: "⚠️ Please provide at least one setting to update (channel, role, or enabled status)."
      });
    }
  },

  /**
   * Handles the 'status' subcommand to show current backup mode settings.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleStatusSubcommand(interaction) {
    await this.showBackupModeStatus(interaction);
  },

  /**
   * Gets the current backup mode settings from the database.
   * @returns {Promise<Object>} The current settings.
   */
  async getCurrentSettings() {
    try {
      const [channelId, roleId, isEnabled] = await Promise.all([
        getValue(CONFIG_KEYS.CHANNEL),
        getValue(CONFIG_KEYS.ROLE),
        getValue(CONFIG_KEYS.ENABLED)
      ]);
      
      return {
        channelId,
        roleId,
        isEnabled: isEnabled === true // Ensure boolean
      };
    } catch (error) {
      logger.error("Failed to retrieve current backup mode settings.", {
        error: error.message,
        stack: error.stack
      });
    
      throw new Error("DATABASE_READ_ERROR");
    }
  },

  /**
   * Validates the channel and role inputs.
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   * @param {Channel|null} channelOption - The channel option if provided.
   * @param {Role|null} roleOption - The role option if provided.
   * @returns {boolean} True if there was a validation error, false otherwise.
   */
  async validateInputs(interaction, channelOption, roleOption) {
    // Validate channel type if provided.
    if (channelOption && channelOption.type !== ChannelType.GuildText) {
      logger.warn("Invalid channel type selected for backup mode.", { 
        channelId: channelOption.id, 
        type: channelOption.type 
      });
      await interaction.editReply({
        content: "⚠️ The channel must be a text channel for welcome messages."
      });
      return true;
    }
    
    // Validate role if provided.
    if (roleOption && (!roleOption.editable || roleOption.managed)) {
      logger.warn("Invalid role selected for backup mode.", { 
        roleId: roleOption.id, 
        managed: roleOption.managed 
      });
      await interaction.editReply({
        content: "⚠️ I cannot assign the selected role. Please choose a role that is below my highest role."
      });
      return true;
    }

    return false;
  },

  /**
   * Updates backup mode settings in the database.
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   * @param {Channel|null} channelOption - The channel to set for welcome messages.
   * @param {Role|null} roleOption - The role to assign to new members.
   * @param {string|null} enabledOption - Whether backup mode is enabled.
   * @param {Object} currentSettings - Current backup mode settings.
   */
  async updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption, currentSettings) {
    try {
      // Track what has changed
      let newIsEnabled = currentSettings.isEnabled;
      let newChannelId = currentSettings.channelId;
      let newRoleId = currentSettings.roleId;
      
      // Update configuration values in database
      if (channelOption) {
        newChannelId = channelOption.id;
        await setValue(CONFIG_KEYS.CHANNEL, channelOption.id);
        logger.debug("Backup mode channel updated.", { 
          channelId: channelOption.id, 
          channelName: channelOption.name 
        });
      }
      
      if (roleOption) {
        newRoleId = roleOption.id;
        await setValue(CONFIG_KEYS.ROLE, roleOption.id);
        logger.debug("Backup mode role updated.", { 
          roleId: roleOption.id, 
          roleName: roleOption.name 
        });
      }
      
      if (enabledOption !== null) {
        newIsEnabled = enabledOption.toLowerCase() === "enabled";
        await setValue(CONFIG_KEYS.ENABLED, newIsEnabled);
        logger.debug("Backup mode enabled status updated.", { enabled: newIsEnabled });
      }
      
      // Format the response message
      const responseMessage = this.formatUpdateMessage(
        currentSettings.isEnabled, newIsEnabled,
        currentSettings.channelId, newChannelId,
        currentSettings.roleId, newRoleId,
        interaction
      );
      await interaction.editReply(responseMessage);
      logger.info("Backup mode configuration updated successfully.", { 
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        channel: channelOption?.id, 
        role: roleOption?.id, 
        enabled: enabledOption 
      });
    } catch (dbError) {
      logger.error("Database operation failed during backup mode update.", { 
        error: dbError.message, 
        stack: dbError.stack 
      });
      
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },

  /**
   * Shows the current backup mode status.
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   */
  async showBackupModeStatus(interaction) {
    logger.debug("Retrieving current backup mode configuration.");
    
    try {
      const settings = await this.getCurrentSettings();
      const statusMessage = this.formatStatusMessage(settings, interaction);
      await interaction.editReply(statusMessage);
      logger.info("Backup mode status check completed successfully.", { 
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
    } catch (dbError) {
      logger.error("Database operation failed during backup mode status check.", { 
        error: dbError.message, 
        stack: dbError.stack 
      });
      
      throw new Error("DATABASE_READ_ERROR");
    }
  },


  /**
   * Formats an update message based on the old and new settings.
   * @param {boolean} oldEnabled - The previous enabled state.
   * @param {boolean} newEnabled - The new enabled state.
   * @param {string} oldChannelId - The previous channel ID.
   * @param {string} newChannelId - The new channel ID.
   * @param {string} oldRoleId - The previous role ID.
   * @param {string} newRoleId - The new role ID.
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   * @returns {string} The formatted update message.
   */
  formatUpdateMessage(oldEnabled, newEnabled, oldChannelId, newChannelId, oldRoleId, newRoleId, interaction) {
    let message = `🔄 **Backup Mode Updated**\n\n`;
    
    // Status
    const statusEmoji = newEnabled ? "✅" : "❌";
    const statusText = newEnabled ? "Enabled" : "Disabled";
    message += `• Status: ${statusEmoji} **${statusText}**\n`;
    
    // Channel
    if (newChannelId) {
      message += `• Welcome Channel: <#${newChannelId}>\n`;
    }
    
    // Role
    if (newRoleId) {
      message += `• New Member Role: <@&${newRoleId}>\n`;
    }
    
    if (newEnabled) {
      message += `\nNew members will be welcomed in <#${newChannelId || 'unset'}> and assigned the <@&${newRoleId || 'unset'}> role.`;
    }
    
    return message;
  },

  /**
   * Formats a status message based on the current settings.
   * @param {Object} settings - The current backup mode settings.
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   * @returns {string} The formatted status message.
   */
  formatStatusMessage(settings, interaction) {
    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "Enabled" : "Disabled";
    
    // Get channel name from ID
    let channelStr = "Not set";
    if (settings.channelId) {
      channelStr = `<#${settings.channelId}>`;
    }
    
    // Get role name from ID
    const roleStr = settings.roleId ? `<@&${settings.roleId}>` : "Not set";
    
    let message = `🔄 **Backup Mode Status**\n\n`;
    message += `• Status: ${statusEmoji} **${statusText}**\n`;
    message += `• Welcome Channel: ${channelStr}\n`;
    message += `• New Member Role: ${roleStr}`;
    
    if (settings.isEnabled) {
      message += `\n\nNew members will be welcomed in ${channelStr} and assigned the ${roleStr} role.`;
    }
    
    return message;
  },

  /**
   * Handles errors that occur during command execution.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logger.error("Error in /backupmode command execution.", { 
      error: error.message, 
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
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
      logger.error("Failed to send error response for backupmode command.", {
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
