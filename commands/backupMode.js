const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { getValue, setValue } = require('../utils/supabase');
const logger = require('../logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backupmode')
    .setDescription('Configure and toggle backup mode for new members.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to send welcome messages (leave empty to check status)')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to assign to new members (leave empty to check status)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('enabled')
        .setDescription('Toggle auto-role assignment ("enabled" or "disabled") (leave empty to check status)')
        .setRequired(false)
        .addChoices(
          { name: 'Enabled', value: 'enabled' },
          { name: 'Disabled', value: 'disabled' }
        )
    ),
    
  async execute(interaction) {
    try {
      logger.debug(`/backupmode command invoked by ${interaction.user.tag}`);
      
      const channelOption = interaction.options.getChannel('channel');
      const roleOption = interaction.options.getRole('role');
      const enabledOption = interaction.options.getString('enabled');
      
      if (channelOption || roleOption || enabledOption !== null) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          logger.warn(`Unauthorized /backupmode setup attempt by ${interaction.user.tag}`);
          await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
          return;
        }
        
        if (channelOption) {
          await setValue("backup_mode_channel", channelOption.id);
          logger.debug(`Backup mode channel set to ${channelOption.name}`);
        }
        if (roleOption) {
          await setValue("backup_mode_role", roleOption.id);
          logger.debug(`Backup mode role set to ${roleOption.id}`);
        }
        if (enabledOption !== null) {
          const isEnabled = enabledOption.toLowerCase() === "enabled";
          await setValue("backup_mode_enabled", isEnabled);
          logger.debug(`Backup mode ${isEnabled ? "enabled" : "disabled"}`);
        }
        
        const replyMsg = `🔄 **Backup Mode Configured!**\n` +
          `📢 Welcome messages will be sent in ${channelOption ? channelOption.name : "Not changed"}\n` +
          `🎭 New members will be assigned the role: ${roleOption ? `<@&${roleOption.id}>` : "Not changed"}\n` +
          `🔘 Auto-role assignment: ${
            enabledOption ? (enabledOption.toLowerCase() === "enabled" ? "✅ **Enabled**" : "❌ **Disabled**") : "Not changed"
          }`;
        await interaction.reply(replyMsg);
        return;
      }
      
      logger.debug(`Backup mode status check requested by ${interaction.user.tag}`);
      const channelId = await getValue("backup_mode_channel");
      const roleId = await getValue("backup_mode_role");
      const enabledStatus = await getValue("backup_mode_enabled");
      
      let channelStr = "Not set!";
      if (channelId) {
        const channelObj = interaction.guild.channels.cache.get(channelId);
        channelStr = channelObj ? channelObj.name : "Not set!";
      }
      const roleStr = roleId ? `<@&${roleId}>` : "Not set!";
      const enabledStr = enabledStatus ? "✅ **Enabled**" : "❌ **Disabled**";
      
      const summary = `📌 **Backup Mode Status:**\n` +
        `📢 **Channel:** ${channelStr}\n` +
        `🎭 **Role:** ${roleStr}\n` +
        `🔘 **Auto-role assignment:** ${enabledStr}`;
      
      await interaction.reply(summary);
      logger.debug("Backup mode status check completed successfully.");
    } catch (e) {
      logger.error(`Error in /backupmode command: ${e}`);
      await interaction.reply({ content: "⚠️ An error occurred while processing your request. Please try again later.", ephemeral: true });
    }
  }
};
