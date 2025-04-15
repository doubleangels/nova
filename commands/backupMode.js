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
 *
 * If no options are provided, the command returns the current backup mode configuration.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('backupmode')
    .setDescription('Configure and toggle backup mode for new members.')
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
        guildId: interaction.guild.id 
      });
      
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
      if (channelOption || roleOption || enabledOption !== null && enabledOption !== undefined) {
        await this.updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption);
      } else {
        // No options provided: perform a status check
        await this.showBackupModeStatus(interaction);
      }
    } catch (error) {
      logger.error("Error in /backupmode command execution.", { 
        error: error.message, 
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later."
      });
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
   */
  async updateBackupModeSettings(interaction, channelOption, roleOption, enabledOption) {
    try {
      // Update configuration values in database
      if (channelOption) {
        await setValue(CONFIG_KEYS.CHANNEL, channelOption.id);
        logger.debug("Backup mode channel updated.", { 
          channelId: channelOption.id, 
          channelName: channelOption.name 
        });
      }
      
      if (roleOption) {
        await setValue(CONFIG_KEYS.ROLE, roleOption.id);
        logger.debug("Backup mode role updated.", { 
          roleId: roleOption.id, 
          roleName: roleOption.name 
        });
      }
      
      if (enabledOption !== null && enabledOption !== undefined) {
        const isEnabled = enabledOption.toLowerCase() === "enabled";
        await setValue(CONFIG_KEYS.ENABLED, isEnabled);
        logger.debug("Backup mode enabled status updated.", { enabled: isEnabled });
      }
      
      // Prepare response message
      let responseMessage = `🔄 **Backup Mode Updated**\n`;
      
      // Add enabled status first if provided
      if (enabledOption !== null && enabledOption !== undefined) {
        const statusEmoji = enabledOption.toLowerCase() === "enabled" ? "✅" : "❌";
        const statusText = enabledOption.toLowerCase() === "enabled" ? "Enabled" : "Disabled";
        responseMessage += `🔘 Backup mode: ${statusEmoji} **${statusText}**\n`;
      }
      
      // Then add channel and role if provided
      if (channelOption) {
        responseMessage += `📢 Welcome channel: <#${channelOption.id}>\n`;
      }
      
      if (roleOption) {
        responseMessage += `🎭 New member role: <@&${roleOption.id}>`;
      }
      
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
      await interaction.editReply({
        content: "⚠️ Failed to save settings. Please try again later."
      });
    }
  },

  /**
   * Shows the current backup mode status.
   * @param {ChatInputCommandInteraction} interaction - The interaction object.
   */
  async showBackupModeStatus(interaction) {
    logger.debug("Retrieving current backup mode configuration.");
    
    try {
      const channelId = await getValue(CONFIG_KEYS.CHANNEL);
      const roleId = await getValue(CONFIG_KEYS.ROLE);
      const enabledStatus = await getValue(CONFIG_KEYS.ENABLED);
      
      // Get channel name from ID.
      let channelStr = "Not set";
      if (channelId) {
        channelStr = `<#${channelId}>`;
      }
      
      const roleStr = roleId ? `<@&${roleId}>` : "Not set";
      const statusEmoji = enabledStatus ? "✅" : "❌";
      const statusText = enabledStatus ? "Enabled" : "Disabled";
      
      const responseMessage = `🔄 **Backup Mode Status**\n` +
        `🔘 Backup mode: ${statusEmoji} **${statusText}**\n` + 
        `📢 Welcome channel: ${channelStr}\n` +
        `🎭 New member role: ${roleStr}`;
      
      await interaction.editReply(responseMessage);
      logger.info("Backup mode status check completed successfully.", { 
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });
    } catch (dbError) {
      logger.error("Database operation failed during backup mode status check.", { 
        error: dbError.message, 
        stack: dbError.stack 
      });
      await interaction.editReply({
        content: "⚠️ Failed to retrieve backup mode settings. Please try again later."
      });
    }
  }
};
