const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * We handle the takerole command.
 * This function allows moderators to remove a specified role from a user.
 *
 * We perform several tasks:
 * 1. Validate permissions and role hierarchy
 * 2. Check if the user has the role
 * 3. Remove the role from the user
 * 4. Log the action and provide feedback
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('takerole')
    .setDescription('Remove a specified role from a user.')
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
    // We defer the reply since role operations might take a moment to complete.
    await interaction.deferReply();
    
    logger.info("Take role command initiated.", {
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
    
    try {
      // We extract all command options provided by the user.
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
      
      // We validate permissions and role assignment before proceeding.
      const validationResult = await this.validateRoleRemoval(interaction, role, targetUser);
      if (!validationResult.valid) {
        return await interaction.editReply({
          content: validationResult.message,
          ephemeral: true
        });
      }
      
      // We remove the role from the user after validation passes.
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
        content: '⚠️ An unexpected error occurred. Please try again later.',
        ephemeral: true
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
    // We check if the bot has permission to manage roles in the server.
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      logger.warn("Bot missing required permissions to manage roles.", {
        guildId: interaction.guildId
      });
      return {
        valid: false,
        message: '⚠️ I don\'t have permission to manage roles. Please check my role permissions.'
      };
    }

    // We check if the role is managed (bot or integration role).
    if (role.managed) {
      logger.warn("Attempted to remove a managed role.", {
        roleId: role.id,
        roleName: role.name
      });
      return {
        valid: false,
        message: '⚠️ I cannot remove managed roles (bot or integration roles).'
      };
    }
    
    // We fetch the target member from the guild to access their roles.
    const targetMember = await this.fetchGuildMember(interaction, targetUser.id);
    
    if (!targetMember) {
      return {
        valid: false,
        message: '⚠️ Failed to fetch the guild member. Please try again.'
      };
    }

    // We check if the user actually has the role that needs to be removed.
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
    
    // We check if the bot's highest role is higher than the role to be removed.
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
    
    // We check role hierarchy for the user issuing the command to enforce Discord's role hierarchy rules.
    // Server owners can manage any role regardless of hierarchy.
    if (interaction.guild.ownerId !== interaction.user.id) {
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
    // We format the audit log reason to include the executor and optional custom reason.
    const customReason = reason ? `: "${reason}"` : '';
    const auditReason = `Role removed by ${interaction.user.tag} using takerole command${customReason}`;
    
    // We remove the role from the user with the formatted audit reason.
    await targetMember.roles.remove(role, auditReason);
    
    logger.info("Role successfully removed from user.", { 
      roleId: role.id, 
      roleName: role.name,
      targetUserId: targetMember.id,
      executorId: interaction.user.id,
      guildId: interaction.guildId,
      reason
    });
    
    // We format a success message to inform the moderator.
    let successMessage = `✅ Successfully removed the ${role} role from ${targetMember.user}!`;
    
    // We add the reason to the success message if one was provided.
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