/**
 * Backup mode command module for managing server backup settings.
 * Handles configuration of welcome channels, auto-role assignment, and status checks.
 * @module commands/backupMode
 */

const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

const BACKUP_CONFIG_CHANNEL = "backup_mode_channel";
const BACKUP_CONFIG_ENABLED = "backup_mode_enabled";
const BACKUP_CONFIG_ROLE = "backup_mode_role";

const BACKUP_EMBED_COLOR_DISABLED = '#FF0000';
const BACKUP_EMBED_COLOR_ENABLED = '#00FF00';
const BACKUP_EMBED_FOOTER_PREFIX = "Requested by";
const BACKUP_EMBED_TITLE_STATUS = '🔄 Backup Mode Status';
const BACKUP_EMBED_TITLE_UPDATE = '🔄 Backup Mode Updated';

const BACKUP_ERROR_DATABASE_READ = "⚠️ Failed to retrieve backup mode settings. Please try again later.";
const BACKUP_ERROR_DATABASE_WRITE = "⚠️ Failed to save backup mode settings. Please try again later.";
const BACKUP_ERROR_INVALID_CHANNEL = "⚠️ The channel must be a text channel for welcome messages.";
const BACKUP_ERROR_INVALID_ROLE = "⚠️ I cannot assign the selected role. Please choose a role that is below my highest role.";
const BACKUP_ERROR_NO_SETTINGS = "⚠️ Please provide at least one setting to update (channel, role, or enabled status).";
const BACKUP_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred. Please try again later.";

const BACKUP_STATUS_DISABLED = "❌";
const BACKUP_STATUS_ENABLED = "✅";

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
   * Executes the backup mode command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If command execution fails
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

      let errorMessage = BACKUP_ERROR_UNEXPECTED;
      
      if (error.message === "DATABASE_READ_ERROR") {
        errorMessage = BACKUP_ERROR_DATABASE_READ;
      } else if (error.message === "DATABASE_WRITE_ERROR") {
        errorMessage = BACKUP_ERROR_DATABASE_WRITE;
      } else if (error.message === "INVALID_CHANNEL_TYPE") {
        errorMessage = BACKUP_ERROR_INVALID_CHANNEL;
      } else if (error.message === "INVALID_ROLE") {
        errorMessage = BACKUP_ERROR_INVALID_ROLE;
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
   * Handles the set subcommand for configuring backup mode settings.
   * @async
   * @function handleSetSubcommand
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
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
        content: BACKUP_ERROR_NO_SETTINGS
      });
    }
  },

  /**
   * Handles the status subcommand for checking backup mode configuration.
   * @async
   * @function handleStatusSubcommand
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   */
  async handleStatusSubcommand(interaction) {
    await this.showBackupModeStatus(interaction);
  },

  /**
   * Retrieves current backup mode settings from the database.
   * @async
   * @function getCurrentSettings
   * @returns {Promise<Object>} Current backup mode settings
   * @throws {Error} If database read fails
   */
  async getCurrentSettings() {
    try {
      const [channelId, roleId, isEnabled] = await Promise.all([
        getValue(BACKUP_CONFIG_CHANNEL),
        getValue(BACKUP_CONFIG_ROLE),
        getValue(BACKUP_CONFIG_ENABLED)
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
   * Validates input options for backup mode settings.
   * @async
   * @function validateInputs
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {import('discord.js').GuildChannel} channelOption - The selected channel
   * @param {import('discord.js').Role} roleOption - The selected role
   * @returns {Promise<boolean>} True if validation failed, false otherwise
   */
  async validateInputs(interaction, channelOption, roleOption) {
    if (channelOption && channelOption.type !== ChannelType.GuildText) {
      logger.warn("Invalid channel type selected for backup mode:", { 
        channelId: channelOption.id, 
        type: channelOption.type 
      });
      await interaction.editReply({
        content: BACKUP_ERROR_INVALID_CHANNEL,
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
        content: BACKUP_ERROR_INVALID_ROLE,
        ephemeral: true
      });
      return true;
    }

    return false;
  },

  /**
   * Updates backup mode settings in the database.
   * @async
   * @function updateBackupModeSettings
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {import('discord.js').GuildChannel} channelOption - The selected channel
   * @param {import('discord.js').Role} roleOption - The selected role
   * @param {string} enabledOption - The enabled status
   * @param {Object} currentSettings - Current backup mode settings
   * @throws {Error} If database write fails
   */
  async updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption, currentSettings) {
    try {
      let newIsEnabled = currentSettings.isEnabled;
      let newChannelId = currentSettings.channelId;
      let newRoleId = currentSettings.roleId;
      
      if (channelOption) {
        newChannelId = channelOption.id;
        await setValue(BACKUP_CONFIG_CHANNEL, channelOption.id);
        logger.debug("Backup mode channel updated:", { 
          channelId: channelOption.id, 
          channelName: channelOption.name 
        });
      }
      
      if (roleOption) {
        newRoleId = roleOption.id;
        await setValue(BACKUP_CONFIG_ROLE, roleOption.id);
        logger.debug("Backup mode role updated:", { 
          roleId: roleOption.id, 
          roleName: roleOption.name 
        });
      }
      
      if (enabledOption !== null) {
        newIsEnabled = enabledOption.toLowerCase() === "enabled";
        await setValue(BACKUP_CONFIG_ENABLED, newIsEnabled);
        logger.debug("Backup mode enabled status updated:", { enabled: newIsEnabled });
      }
      
      const embed = this.formatUpdateMessage(
        currentSettings.isEnabled, newIsEnabled,
        currentSettings.channelId, newChannelId,
        currentSettings.roleId, newRoleId,
        interaction
      );
      
      await interaction.editReply({ embeds: [embed] });
      logger.info("Backup mode configuration updated successfully:", { 
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
   * Displays current backup mode status.
   * @async
   * @function showBackupModeStatus
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
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
   * Formats the update message for backup mode settings.
   * @function formatUpdateMessage
   * @param {boolean} oldEnabled - Previous enabled status
   * @param {boolean} newEnabled - New enabled status
   * @param {string} oldChannelId - Previous channel ID
   * @param {string} newChannelId - New channel ID
   * @param {string} oldRoleId - Previous role ID
   * @param {string} newRoleId - New role ID
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @returns {string} Formatted update message
   */
  formatUpdateMessage(oldEnabled, newEnabled, oldChannelId, newChannelId, oldRoleId, newRoleId, interaction) {
    const embed = new EmbedBuilder()
      .setColor(newEnabled ? BACKUP_EMBED_COLOR_ENABLED : BACKUP_EMBED_COLOR_DISABLED)
      .setTitle(BACKUP_EMBED_TITLE_UPDATE)
      .setTimestamp();

    const statusEmoji = newEnabled ? BACKUP_STATUS_ENABLED : BACKUP_STATUS_DISABLED;
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

    embed.setFooter({ text: `Updated by ${interaction.user.tag}` });
    
    return embed;
  },

  /**
   * Formats the status message for backup mode settings.
   * @function formatStatusMessage
   * @param {Object} settings - Current backup mode settings
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @returns {string} Formatted status message
   */
  formatStatusMessage(settings, interaction) {
    const embed = new EmbedBuilder()
      .setColor(settings.isEnabled ? BACKUP_EMBED_COLOR_ENABLED : BACKUP_EMBED_COLOR_DISABLED)
      .setTitle(BACKUP_EMBED_TITLE_STATUS)
      .setTimestamp();

    const statusEmoji = settings.isEnabled ? BACKUP_STATUS_ENABLED : BACKUP_STATUS_DISABLED;
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

    embed.setFooter({ text: `${BACKUP_EMBED_FOOTER_PREFIX} ${interaction.user.tag}` });
    
    return embed;
  }
};