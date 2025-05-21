const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We define configuration constants for database keys to maintain consistency.
const CONFIG_KEYS = {
  CHANNEL: "backup_mode_channel",
  ROLE: "backup_mode_role",
  ENABLED: "backup_mode_enabled"
};

/**
 * We handle the backupmode command.
 * This function configures and manages backup mode settings for new members.
 *
 * We perform several tasks:
 * 1. We configure welcome channel for new members.
 * 2. We set up auto-role assignment.
 * 3. We toggle backup mode status.
 * 4. We display current configuration.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('backupmode')
    .setDescription('Configure and manage backup mode settings for new members.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Configure backup mode settings.')
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
        .setDescription('Check the current backup mode configuration.')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

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
   * We handle the 'set' subcommand to update backup mode settings.
   * This function processes user input and updates the configuration.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleSetSubcommand(interaction) {
    // We retrieve the command options provided by the user.
    const channelOption = interaction.options.getChannel('channel');
    const roleOption = interaction.options.getRole('role');
    const enabledOption = interaction.options.getString('enabled');
    
    // We validate the inputs if they were provided by the user.
    const validationError = await this.validateInputs(interaction, channelOption, roleOption);
    if (validationError) {
      return;
    }
    
    // We update the settings if any configuration option is provided.
    if (channelOption || roleOption || enabledOption !== null) {
      // We get the current settings for comparison with the new values.
      const currentSettings = await this.getCurrentSettings();
      
      await this.updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption, currentSettings);
    } else {
      // We inform the user that at least one setting is required.
      await interaction.editReply({
        content: "⚠️ Please provide at least one setting to update (channel, role, or enabled status)."
      });
    }
  },

  /**
   * We handle the 'status' subcommand to show current backup mode settings.
   * This function retrieves and displays the current configuration.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async handleStatusSubcommand(interaction) {
    await this.showBackupModeStatus(interaction);
  },

  /**
   * We get the current backup mode settings from the database.
   * This function retrieves all configuration values in parallel.
   *
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
        isEnabled: isEnabled === true // We ensure this is a boolean value.
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
   * We validate the channel and role inputs.
   * This function ensures the selected options are valid and usable.
   *
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   * @param {Channel|null} channelOption - The channel option if provided.
   * @param {Role|null} roleOption - The role option if provided.
   * @returns {boolean} True if there was a validation error, false otherwise.
   */
  async validateInputs(interaction, channelOption, roleOption) {
    // We validate the channel type if one was provided.
    if (channelOption && channelOption.type !== ChannelType.GuildText) {
      logger.warn("Invalid channel type selected for backup mode.", { 
        channelId: channelOption.id, 
        type: channelOption.type 
      });
      await interaction.editReply({
        content: ERROR_MESSAGES.INVALID_CHANNEL_TYPE,
        ephemeral: true
      });
      return true;
    }

    // We validate the role if one was provided.
    if (roleOption && (!roleOption.editable || roleOption.managed)) {
      logger.warn("Invalid role selected for backup mode.", { 
        roleId: roleOption.id, 
        managed: roleOption.managed 
      });
      await interaction.editReply({
        content: ERROR_MESSAGES.INVALID_ROLE,
        ephemeral: true
      });
      return true;
    }

    return false;
  },

  /**
   * We update backup mode settings in the database.
   * This function saves the new configuration values.
   *
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   * @param {Channel|null} channelOption - The channel to set for welcome messages.
   * @param {Role|null} roleOption - The role to assign to new members.
   * @param {string|null} enabledOption - Whether backup mode is enabled.
   * @param {Object} currentSettings - Current backup mode settings.
   */
  async updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption, currentSettings) {
    try {
      // We track what settings have changed.
      let newIsEnabled = currentSettings.isEnabled;
      let newChannelId = currentSettings.channelId;
      let newRoleId = currentSettings.roleId;
      
      // We update the configuration values in the database.
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
      
      // We format the response message to show what was updated.
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
      logger.error("Failed to update backup mode settings.", {
        error: dbError.message, 
        stack: dbError.stack,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },

  /**
   * We show the current backup mode status.
   * This function retrieves and displays the current configuration.
   *
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
   * We format an update message based on the old and new settings.
   * This function creates a user-friendly message showing what changed.
   *
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
    
    // We display the current status with an appropriate emoji.
    const statusEmoji = newEnabled ? "✅" : "❌";
    const statusText = newEnabled ? "Enabled" : "Disabled";
    message += `• Status: ${statusEmoji} **${statusText}**\n`;
    
    // We include the channel information if it exists.
    if (newChannelId) {
      message += `• Welcome Channel: <#${newChannelId}>\n`;
    }
    
    // We include the role information if it exists.
    if (newRoleId) {
      message += `• New Member Role: <@&${newRoleId}>\n`;
    }
    
    if (newEnabled) {
      message += `\nNew members will be welcomed in <#${newChannelId || 'unset'}> and assigned the <@&${newRoleId || 'unset'}> role.`;
    }
    
    return message;
  },

  /**
   * We format a status message based on the current settings.
   * This function creates a user-friendly message showing the current configuration.
   *
   * @param {Object} settings - The current backup mode settings.
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   * @returns {string} The formatted status message.
   */
  formatStatusMessage(settings, interaction) {
    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "Enabled" : "Disabled";
    
    // We get the channel name from its ID or show "Not set" if it doesn't exist.
    let channelStr = "Not set";
    if (settings.channelId) {
      channelStr = `<#${settings.channelId}>`;
    }
    
    // We get the role name from its ID or show "Not set" if it doesn't exist.
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
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'backupmode', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_READ_ERROR;
    } else if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = ERROR_MESSAGES.DATABASE_WRITE_ERROR;
    } else if (error.message === "INVALID_CHANNEL_TYPE") {
      errorMessage = ERROR_MESSAGES.BACKUPMODE_INVALID_CHANNEL;
    } else if (error.message === "INVALID_ROLE") {
      errorMessage = ERROR_MESSAGES.BACKUPMODE_INVALID_ROLE;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for backup mode command:", {
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