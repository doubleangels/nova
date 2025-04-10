const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Module for the /takerole command.
 * Removes a specified role from a specified user.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('takerole')
    .setDescription('Removes a specified role from a user.')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('What role would you like to remove?')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Which user should have this role removed?')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  
  /**
   * Executes the /takerole command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    // Defer reply since this might take a moment.
    await interaction.deferReply();
    
    logger.info("Take role command initiated.", {
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
    
    try {
      // Extract command options.
      const role = interaction.options.getRole('role');
      const targetUser = interaction.options.getUser('user');
      
      logger.debug("Processing take role command.", { 
        roleId: role.id,
        roleName: role.name,
        targetUserId: targetUser.id,
        executorId: interaction.user.id
      });
      
      // Check if the bot has permission to manage roles.
      if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        logger.warn("Bot missing required permissions to manage roles.", {
          guildId: interaction.guildId
        });
        
        return await interaction.editReply({
          content: '⚠️ I don\'t have permission to manage roles. Please check my role permissions.',
          ephemeral: true
        });
      }
      
      // Fetch the target member from the guild.
      const targetMember = await fetchGuildMember(interaction, targetUser.id);
      
      if (!targetMember) {
        return await interaction.editReply({
          content: '⚠️ Failed to fetch the guild member. Please try again.',
          ephemeral: true
        });
      }
      
      // Check if the user has the role.
      if (!targetMember.roles.cache.has(role.id)) {
        logger.debug("User doesn't have the specified role.", {
          userId: targetUser.id,
          roleId: role.id,
          guildId: interaction.guildId
        });
        
        return await interaction.editReply({
          content: `⚠️ ${targetUser} doesn't have the ${role} role.`,
          ephemeral: true
        });
      }
      
      // Check if the bot's highest role is higher than the role to be removed.
      const botMember = interaction.guild.members.me;
      if (botMember.roles.highest.position <= role.position) {
        logger.warn("Role hierarchy prevents role removal.", {
          botHighestRole: botMember.roles.highest.id,
          targetRoleId: role.id,
          guildId: interaction.guildId
        });
        
        return await interaction.editReply({
          content: '⚠️ I cannot remove this role because it\'s positioned higher than or equal to my highest role.',
          ephemeral: true
        });
      }
      
      // Remove the role from the user.
      const auditReason = `Role removed by ${interaction.user.tag} using takerole command.`;
      await targetMember.roles.remove(role, auditReason);
      
      logger.info("Role successfully removed from user.", { 
        roleId: role.id, 
        roleName: role.name,
        targetUserId: targetUser.id,
        executorId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      await interaction.editReply({
        content: `✅ Successfully removed the ${role} role from ${targetUser}!`
      });
      
    } catch (error) {
      logger.error("Error executing take role command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      await interaction.editReply({ 
        content: '⚠️ An unexpected error occurred. Please try again later.', 
        ephemeral: true 
      });
    }
  },
};

/**
 * Fetches a guild member with error handling.
 * @param {Interaction} interaction - The Discord interaction object.
 * @param {string} userId - The ID of the user to fetch.
 * @returns {Promise<GuildMember|null>} The guild member or null if not found.
 */
async function fetchGuildMember(interaction, userId) {
  try {
    return await interaction.guild.members.fetch(userId);
  } catch (error) {
    logger.error("Failed to fetch guild member.", {
      userId,
      guildId: interaction.guildId,
      error: error.message
    });
    return null;
  }
}
