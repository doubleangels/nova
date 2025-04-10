const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'takerole',
  DESCRIPTION: 'Removes a specified role from a user.',
  ROLE_OPTION: {
    NAME: 'role',
    DESCRIPTION: 'What role would you like to remove?'
  },
  USER_OPTION: {
    NAME: 'user',
    DESCRIPTION: 'Which user should have this role removed?'
  },
  RESPONSES: {
    SUCCESS: '✅ Successfully removed the %s role from %s!',
    USER_NO_ROLE: '⚠️ %s doesn\'t have the %s role.',
    BOT_MISSING_PERMISSIONS: '⚠️ I don\'t have permission to manage roles. Please check my role permissions.',
    ROLE_HIERARCHY_ERROR: '⚠️ I cannot remove this role because it\'s positioned higher than or equal to my highest role.',
    ERROR: '⚠️ An unexpected error occurred. Please try again later.',
    FAILED_TO_FETCH: '⚠️ Failed to fetch the guild member. Please try again.'
  },
  AUDIT_REASON: 'Role removed by %s using takerole command.'
};

/**
 * Module for the /takerole command.
 * Removes a specified role from a specified user.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_CONFIG.NAME)
    .setDescription(COMMAND_CONFIG.DESCRIPTION)
    .addRoleOption(option =>
      option.setName(COMMAND_CONFIG.ROLE_OPTION.NAME)
        .setDescription(COMMAND_CONFIG.ROLE_OPTION.DESCRIPTION)
        .setRequired(true))
    .addUserOption(option =>
      option.setName(COMMAND_CONFIG.USER_OPTION.NAME)
        .setDescription(COMMAND_CONFIG.USER_OPTION.DESCRIPTION)
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
      const role = interaction.options.getRole(COMMAND_CONFIG.ROLE_OPTION.NAME);
      const targetUser = interaction.options.getUser(COMMAND_CONFIG.USER_OPTION.NAME);
      
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
          content: COMMAND_CONFIG.RESPONSES.BOT_MISSING_PERMISSIONS,
          ephemeral: true
        });
      }
      
      // Fetch the target member from the guild.
      const targetMember = await fetchGuildMember(interaction, targetUser.id);
      
      if (!targetMember) {
        return await interaction.editReply({
          content: COMMAND_CONFIG.RESPONSES.FAILED_TO_FETCH,
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
          content: COMMAND_CONFIG.RESPONSES.USER_NO_ROLE.replace('%s', targetUser).replace('%s', role),
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
          content: COMMAND_CONFIG.RESPONSES.ROLE_HIERARCHY_ERROR,
          ephemeral: true
        });
      }
      
      // Remove the role from the user.
      const auditReason = COMMAND_CONFIG.AUDIT_REASON.replace('%s', interaction.user.tag);
      await targetMember.roles.remove(role, auditReason);
      
      logger.info("Role successfully removed from user.", { 
        roleId: role.id, 
        roleName: role.name,
        targetUserId: targetUser.id,
        executorId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      await interaction.editReply({
        content: COMMAND_CONFIG.RESPONSES.SUCCESS.replace('%s', role).replace('%s', targetUser)
      });
      
    } catch (error) {
      logger.error("Error executing take role command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      await interaction.editReply({ 
        content: COMMAND_CONFIG.RESPONSES.ERROR, 
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
