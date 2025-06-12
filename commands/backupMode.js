const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

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

  async handleStatusSubcommand(interaction) {
    await this.showBackupModeStatus(interaction);
  },

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

  formatUpdateMessage(oldEnabled, newEnabled, oldChannelId, newChannelId, oldRoleId, newRoleId, interaction) {
    const embed = new EmbedBuilder()
      .setColor(newEnabled ? '#00FF00' : '#FF0000')
      .setTitle('🔄 Backup Mode Updated')
      .setTimestamp();

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

    embed.setFooter({ text: `Updated by ${interaction.user.tag}` });
    
    return embed;
  },

  formatStatusMessage(settings, interaction) {
    const embed = new EmbedBuilder()
      .setColor(settings.isEnabled ? '#00FF00' : '#FF0000')
      .setTitle('🔄 Backup Mode Status')
      .setTimestamp();

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

    embed.setFooter({ text: `Requested by ${interaction.user.tag}` });
    
    return embed;
  }
};