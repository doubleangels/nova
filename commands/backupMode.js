const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

/**
 * @typedef {Object} BackupModeSettings
 * @property {string|null} channelId - ID of the welcome channel
 * @property {string|null} roleId - ID of the role to assign
 * @property {boolean} isEnabled - Whether backup mode is enabled
 */

/**
 * Command module for managing backup mode settings
 * @type {Object}
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

  /**
   * Executes the backup mode command
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   * @throws {Error} If the command execution fails
   */
  async execute(interaction) {
    await interaction.deferReply();
    try {
      logger.info("/backupmode command initiated:", { 
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
      logger.error("Error in backup mode command:", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });

      let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";
      
      if (error.message === "DATABASE_READ_ERROR") {
        errorMessage = "⚠️ Failed to retrieve backup mode settings. Please try again later.";
      } else if (error.message === "DATABASE_WRITE_ERROR") {
        errorMessage = "⚠️ Failed to save backup mode settings. Please try again later.";
      } else if (error.message === "INVALID_CHANNEL_TYPE") {
        errorMessage = "⚠️ The channel must be a text channel for welcome messages.";
      } else if (error.message === "INVALID_ROLE") {
        errorMessage = "⚠️ I cannot assign the selected role. Please choose a role that is below my highest role.";
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
        }).catch(() => {});
      }
    }
  },

  /**
   * Handles the 'set' subcommand for configuring backup mode
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async handleSetSubcommand(interaction) {
    const channelOption = interaction.options.getChannel('channel');
    const roleOption = interaction.options.getRole('role');
    const enabledOption = interaction.options.getString('enabled');
    
    const validationError = await this.validateInputs(interaction, channelOption, roleOption);
    if (validationError) {
      return;
    }
    
    if (channelOption || roleOption || enabledOption !== null) {
      const currentSettings = await this.getCurrentSettings();
      
      await this.updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption, currentSettings);
    } else {
      await interaction.editReply({
        content: "⚠️ Please provide at least one setting to update (channel, role, or enabled status)."
      });
    }
  },

  /**
   * Handles the 'status' subcommand for checking backup mode configuration
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   */
  async handleStatusSubcommand(interaction) {
    await this.showBackupModeStatus(interaction);
  },

  /**
   * Retrieves current backup mode settings from the database
   * @returns {Promise<BackupModeSettings>} Current backup mode settings
   * @throws {Error} If database read fails
   */
  async getCurrentSettings() {
    try {
      const [channelId, roleId, isEnabled] = await Promise.all([
        getValue("backup_mode_channel"),
        getValue("backup_mode_role"),
        getValue("backup_mode_enabled")
      ]);
      
      return {
        channelId,
        roleId,
        isEnabled: isEnabled === true
      };
    } catch (error) {
      logger.error("Failed to retrieve current backup mode settings:", {
        error: error.message,
        stack: error.stack
      });

      throw new Error("DATABASE_READ_ERROR");
    }
  },

  /**
   * Validates input options for backup mode configuration
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {GuildChannel|null} channelOption - The selected channel
   * @param {Role|null} roleOption - The selected role
   * @returns {Promise<boolean>} True if validation failed, false otherwise
   */
  async validateInputs(interaction, channelOption, roleOption) {
    if (channelOption && channelOption.type !== ChannelType.GuildText) {
      logger.warn("Invalid channel type selected for backup mode:", { 
        channelId: channelOption.id, 
        type: channelOption.type 
      });
      await interaction.editReply({
        content: "⚠️ The channel must be a text channel for welcome messages.",
        ephemeral: true
      });
      return true;
    }

    if (roleOption && (!roleOption.editable || roleOption.managed)) {
      logger.warn("Invalid role selected for backup mode:", { 
        roleId: roleOption.id, 
        managed: roleOption.managed 
      });
      await interaction.editReply({
        content: "⚠️ I cannot assign the selected role. Please choose a role that is below my highest role.",
        ephemeral: true
      });
      return true;
    }

    return false;
  },

  /**
   * Updates backup mode settings in the database
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {GuildChannel|null} channelOption - The selected channel
   * @param {Role|null} roleOption - The selected role
   * @param {string|null} enabledOption - The enabled status
   * @param {BackupModeSettings} currentSettings - Current backup mode settings
   * @returns {Promise<void>}
   * @throws {Error} If database write fails
   */
  async updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption, currentSettings) {
    try {
      let newIsEnabled = currentSettings.isEnabled;
      let newChannelId = currentSettings.channelId;
      let newRoleId = currentSettings.roleId;
      
      if (channelOption) {
        newChannelId = channelOption.id;
        await setValue("backup_mode_channel", channelOption.id);
        logger.debug("Backup mode channel updated:", { 
          channelId: channelOption.id, 
          channelName: channelOption.name 
        });
      }
      
      if (roleOption) {
        newRoleId = roleOption.id;
        await setValue("backup_mode_role", roleOption.id);
        logger.debug("Backup mode role updated:", { 
          roleId: roleOption.id, 
          roleName: roleOption.name 
        });
      }
      
      if (enabledOption !== null) {
        newIsEnabled = enabledOption.toLowerCase() === "enabled";
        await setValue("backup_mode_enabled", newIsEnabled);
        logger.debug("Backup mode enabled status updated:", { enabled: newIsEnabled });
      }
      
      const embed = this.formatUpdateMessage(
        currentSettings.isEnabled, newIsEnabled,
        currentSettings.channelId, newChannelId,
        currentSettings.roleId, newRoleId,
        interaction
      );
      
      await interaction.editReply({ embeds: [embed] });
      logger.info("/backupmode command completed successfully:", { 
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        channel: channelOption?.id, 
        role: roleOption?.id, 
        enabled: enabledOption 
      });
    } catch (dbError) {
      logger.error("Failed to update backup mode settings:", {
        error: dbError.message, 
        stack: dbError.stack,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
      throw new Error("DATABASE_WRITE_ERROR");
    }
  },

  /**
   * Displays current backup mode status
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   * @throws {Error} If database read fails
   */
  async showBackupModeStatus(interaction) {
    logger.debug("Retrieving current backup mode configuration.");
    
    try {
      const settings = await this.getCurrentSettings();
      const embed = this.formatStatusMessage(settings, interaction);
      
      await interaction.editReply({ embeds: [embed] });
      logger.info("Backup mode status check completed successfully:", { 
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
    } catch (dbError) {
      logger.error("Database operation failed during backup mode status check:", { 
        error: dbError.message, 
        stack: dbError.stack 
      });
      
      throw new Error("DATABASE_READ_ERROR");
    }
  },

  /**
   * Creates an embed message for backup mode updates
   * @param {boolean} oldEnabled - Previous enabled status
   * @param {boolean} newEnabled - New enabled status
   * @param {string|null} oldChannelId - Previous channel ID
   * @param {string|null} newChannelId - New channel ID
   * @param {string|null} oldRoleId - Previous role ID
   * @param {string|null} newRoleId - New role ID
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {EmbedBuilder} Discord embed with update information
   */
  formatUpdateMessage(oldEnabled, newEnabled, oldChannelId, newChannelId, oldRoleId, newRoleId, interaction) {
    const embed = new EmbedBuilder()
      .setColor(newEnabled ? 0x00FF00 : 0xFF0000)
      .setTitle('🔄 Backup Mode Updated');

    const statusEmoji = newEnabled ? "✅" : "❌";
    const statusText = newEnabled ? "Enabled" : "Disabled";
    embed.addFields({ name: 'Status', value: `${statusEmoji} **${statusText}**` });
    
    if (newChannelId) {
      embed.addFields({ name: 'Welcome Channel', value: `<#${newChannelId}>` });
    }
    
    if (newRoleId) {
      embed.addFields({ name: 'New Member Role', value: `<@&${newRoleId}>` });
    }
    
    if (newEnabled) {
      embed.setDescription(`New members will be welcomed in <#${newChannelId || 'unset'}> and assigned the <@&${newRoleId || 'unset'}> role.`);
    }

    return embed;
  },

  /**
   * Creates an embed message for backup mode status
   * @param {BackupModeSettings} settings - Current backup mode settings
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {EmbedBuilder} Discord embed with status information
   */
  formatStatusMessage(settings, interaction) {
    const embed = new EmbedBuilder()
      .setColor(settings.isEnabled ? 0x00FF00 : 0xFF0000)
      .setTitle('🔄 Backup Mode Status');

    const statusEmoji = settings.isEnabled ? "✅" : "❌";
    const statusText = settings.isEnabled ? "Enabled" : "Disabled";
    embed.addFields({ name: 'Status', value: `${statusEmoji} **${statusText}**` });
    
    let channelStr = "Not set";
    if (settings.channelId) {
      channelStr = `<#${settings.channelId}>`;
    }
    embed.addFields({ name: 'Welcome Channel', value: channelStr });
    
    const roleStr = settings.roleId ? `<@&${settings.roleId}>` : "Not set";
    embed.addFields({ name: 'New Member Role', value: roleStr });
    
    if (settings.isEnabled) {
      embed.setDescription(`New members will be welcomed in ${channelStr} and assigned the ${roleStr} role.`);
    }

    return embed;
  }
};