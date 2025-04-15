const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
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
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for removing this role (will appear in audit log)')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  
  /**
   * Executes the /takerole command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
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
      const reason = interaction.options.getString('reason');
      
      logger.debug("Processing take role command.", { 
        roleId: role.id,
        roleName: role.name,
        targetUserId: targetUser.id,
        executorId: interaction.user.id,
        reason
      });
      
      // Validate permissions and role assignment
      const validationResult = await this.validateRoleRemoval(interaction, role, targetUser);
      if (!validationResult.valid) {
        return await interaction.editReply({
          content: validationResult.message
        });
      }
      
      // Remove the role from the user
      const { targetMember } = validationResult;
      await this.removeRoleFromMember(interaction, targetMember, role, reason);
    } catch (error) {
      logger.error("Error executing take role command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      await interaction.editReply({ 
        content: '⚠️ An unexpected error occurred. Please try again later.'
      });
    }
  },
  /**
   * Validates that the role can be removed from the user.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Role} role - The role to be removed.
   * @param {User} targetUser - The user to remove the role from.
   * @returns {Promise<Object>} Validation result with success status and message.
   */
  async validateRoleRemoval(interaction, role, targetUser) {
    // Check if the bot has permission to manage roles.
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      logger.warn("Bot missing required permissions to manage roles.", {
        guildId: interaction.guildId
      });
      return {
        valid: false,
        message: '⚠️ I don\'t have permission to manage roles. Please check my role permissions.'
      };
    }
    
    // Fetch the target member from the guild.
    const targetMember = await this.fetchGuildMember(interaction, targetUser.id);
    
    if (!targetMember) {
      return {
        valid: false,
        message: '⚠️ Failed to fetch the guild member. Please try again.'
      };
    }

    // Check if the user has the role.
    if (!targetMember.roles.cache.has(role.id)) {
      logger.debug("User doesn't have the specified role.", {
        userId: targetUser.id,
        roleId: role.id,
        guildId: interaction.guildId
      });

      return {
        valid: false,
        message: `⚠️ ${targetUser} doesn't have the ${role} role.`
      };
    }
    
    // Check if the bot's highest role is higher than the role to be removed.
    const botMember = interaction.guild.members.me;
    if (botMember.roles.highest.position <= role.position) {
      logger.warn("Role hierarchy prevents role removal.", {
        botHighestRole: botMember.roles.highest.id,
        targetRoleId: role.id,
        guildId: interaction.guildId
      });
      
      return {
        valid: false,
        message: '⚠️ I cannot remove this role because it\'s positioned higher than or equal to my highest role.'
      };
    }
    
    // Check if the command executor's highest role is higher than the role to be removed
    const executorMember = await this.fetchGuildMember(interaction, interaction.user.id);
    if (executorMember && executorMember.roles.highest.position <= role.position) {
      logger.warn("Role hierarchy prevents role removal by executor.", {
        executorHighestRole: executorMember.roles.highest.id,
        targetRoleId: role.id,
        guildId: interaction.guildId
      });
      
      return {
        valid: false,
        message: '⚠️ You cannot remove this role because it\'s positioned higher than or equal to your highest role.'
      };
    }
    
    return {
      valid: true,
      targetMember
    };
  },
  
  /**
   * Removes a role from a guild member and sends a response.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {GuildMember} targetMember - The member to remove the role from.
   * @param {Role} role - The role to be removed.
   * @param {string|null} reason - The reason for removing the role.
   */
  async removeRoleFromMember(interaction, targetMember, role, reason) {
    // Format audit log reason
    const customReason = reason ? `: "${reason}"` : '';
    const auditReason = `Role removed by ${interaction.user.tag} using takerole command${customReason}`;
    
    // Remove the role from the user
    await targetMember.roles.remove(role, auditReason);
    
    logger.info("Role successfully removed from user.", { 
      roleId: role.id, 
      roleName: role.name,
      targetUserId: targetMember.id,
      executorId: interaction.user.id,
      guildId: interaction.guildId,
      reason
    });
    
    // Format success message
    let successMessage = `✅ Successfully removed the ${role} role from ${targetMember.user}!`;
    
    // Add reason if provided
    if (reason) {
      successMessage += `\n📝 **Reason:** ${reason}`;
    }
    
    await interaction.editReply({
      content: successMessage
    });
  },
  
  /**
   * Fetches a guild member with error handling.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {string} userId - The ID of the user to fetch.
   * @returns {Promise<GuildMember|null>} The guild member or null if not found.
   */
  async fetchGuildMember(interaction, userId) {
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
};