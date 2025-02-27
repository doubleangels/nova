const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, setValue } = require('../utils/supabase');

/**
 * Module for the /backupmode command.
 * This command configures and toggles backup mode for new members by setting:
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
        .setDescription('Toggle auto-role assignment ("enabled" or "disabled") (leave empty to check status)')
        .setRequired(false)
        .addChoices(
          { name: 'Enabled', value: 'enabled' },
          { name: 'Disabled', value: 'disabled' }
        )
    )
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to send welcome messages (leave empty to check status)')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to assign to new members (leave empty to check status)')
        .setRequired(false)
    ),
    
  /**
   * Executes the /backupmode command.
   * @param {Interaction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    try {
      // Log the invocation of the backupmode command.
      logger.debug(`/backupmode command invoked by ${interaction.user.tag}`);
      
      // Retrieve command options for channel, role, and enabled state.
      const channelOption = interaction.options.getChannel('channel');
      const roleOption = interaction.options.getRole('role');
      const enabledOption = interaction.options.getString('enabled');
      
      // Check if any configuration option was provided.
      if (channelOption || roleOption || enabledOption !== null) {
        // Verify if the user has Administrator permissions.
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          logger.warn(`Unauthorized /backupmode setup attempt by ${interaction.user.tag}`);
          await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
          return;
        }
        
        // If a channel option is provided, save it in the database.
        if (channelOption) {
          await setValue("backup_mode_channel", channelOption.id);
          logger.debug(`Backup mode channel set to ${channelOption.name}`);
        }
        // If a role option is provided, save it in the database.
        if (roleOption) {
          await setValue("backup_mode_role", roleOption.id);
          logger.debug(`Backup mode role set to ${roleOption.id}`);
        }
        // If the enabled option is provided, determine its boolean value and save it.
        if (enabledOption !== null) {
          const isEnabled = enabledOption.toLowerCase() === "enabled";
          await setValue("backup_mode_enabled", isEnabled);
          logger.debug(`Backup mode ${isEnabled ? "enabled" : "disabled"}`);
        }
        
        // Prepare the reply message summarizing the new configuration.
        const replyMsg = `🔄 **Backup Mode Configured!**\n` +
          `📢 Welcome messages will be sent in ${channelOption ? channelOption.name : "Not changed"}\n` +
          `🎭 New members will be assigned the role: ${roleOption ? `<@&${roleOption.id}>` : "Not changed"}\n` +
          `🔘 Auto-role assignment: ${
            enabledOption ? (enabledOption.toLowerCase() === "enabled" ? "✅ **Enabled**" : "❌ **Disabled**") : "Not changed"
          }`;
        await interaction.reply(replyMsg);
        return;
      }
      
      // If no options are provided, perform a status check.
      logger.debug(`Backup mode status check requested by ${interaction.user.tag}`);
      
      // Retrieve current backup mode settings from the database.
      const channelId = await getValue("backup_mode_channel");
      const roleId = await getValue("backup_mode_role");
      const enabledStatus = await getValue("backup_mode_enabled");
      
      // Determine the channel name from the channel ID.
      let channelStr = "Not set!";
      if (channelId) {
        const channelObj = interaction.guild.channels.cache.get(channelId);
        channelStr = channelObj ? channelObj.name : "Not set!";
      }
      // Format role and enabled status for display.
      const roleStr = roleId ? `<@&${roleId}>` : "Not set!";
      const enabledStr = enabledStatus ? "✅ **Enabled**" : "❌ **Disabled**";
      
      // Create a summary message with the current backup mode configuration.
      const summary = `📌 **Backup Mode Status:**\n` +
        `📢 **Channel:** ${channelStr}\n` +
        `🎭 **Role:** ${roleStr}\n` +
        `🔘 **Auto-role assignment:** ${enabledStr}`;
      
      await interaction.reply(summary);
      logger.debug("Backup mode status check completed successfully.");
    } catch (e) {
      // Log any errors and inform the user.
      logger.error(`Error in /backupmode command: ${e}`);
      await interaction.reply({ content: "⚠️ An error occurred while processing your request. Please try again later.", ephemeral: true });
    }
  }
};
