const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/database');

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
    .setDefaultMemberPermissions(PermissionsBitField.Administrator),
    
  /**
   * Executes the /backupmode command.
   * @param {Interaction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    await interaction.deferReply();
    try {
      logger.debug("/backupmode command received", { user: interaction.user.tag });
      
      // Retrieve command options.
      const channelOption = interaction.options.getChannel('channel');
      const roleOption = interaction.options.getRole('role');
      const enabledOption = interaction.options.getString('enabled');

      // If any configuration option is provided, attempt to update backup mode settings.
      if (channelOption || roleOption || enabledOption !== null) {
        // Update configuration values in database
        if (channelOption) {
          await setValue("backup_mode_channel", channelOption.id);
          logger.debug("Backup mode channel updated:", { channelId: channelOption.id, channelName: channelOption.name });
        }
        if (roleOption) {
          await setValue("backup_mode_role", roleOption.id);
          logger.debug("Backup mode role updated:", { roleId: roleOption.id, roleName: roleOption.name });
        }
        if (enabledOption !== null) {
          const isEnabled = enabledOption.toLowerCase() === "enabled";
          await setValue("backup_mode_enabled", isEnabled);
          logger.debug("Backup mode enabled status updated:", { enabled: isEnabled });
        }
        
        // Prepare response message
        let responseMessage = `🔄 **Backup Mode Updated**\n`;
        
        // Add enabled status first if provided
        if (enabledOption !== null) {
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
        
        await interaction.reply(responseMessage);
        logger.debug("Backup mode configuration updated:", { user: interaction.user.tag, channel: channelOption?.id, role: roleOption?.id, enabled: enabledOption });
        return;
      }
      
      // No options provided: perform a status check.
      logger.debug("Backup mode status check requested:", { user: interaction.user.tag });
      
      const channelId = await getValue("backup_mode_channel");
      const roleId = await getValue("backup_mode_role");
      const enabledStatus = await getValue("backup_mode_enabled");
      
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
      
      await interaction.reply(responseMessage);
      logger.debug("Backup mode status check completed:", { user: interaction.user.tag });
    } catch (error) {
      logger.error("Error in /backupmode command:", { error });
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
