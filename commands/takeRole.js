/**
 * Take role command module for removing roles from users.
 * Handles role removal, permission validation, and audit logging.
 * @module commands/takeRole
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

/**
 * We handle the takerole command.
 * This function allows moderators to remove a specified role from a user.
 *
 * We perform several tasks:
 * 1. We validate permissions and role hierarchy.
 * 2. We check if the user has the role.
 * 3. We remove the role from the user.
 * 4. We log the action and provide feedback.
 *
 * @param {Interaction} interaction - The Discord interaction object.
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
   * Executes the take role command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If role removal fails
   */
  async execute(interaction) {
    // We defer the reply since role operations might take a moment to complete.
    await interaction.deferReply();
    
    logger.info("/takerole command initiated:", {
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
    
    try {
      // We extract all command options provided by the user.
      const role = interaction.options.getRole('role');
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      
      logger.debug("Processing command options:", {
        targetUser: targetUser.id,
        roleId: role.id
      });
      
      // We validate permissions and role assignment before proceeding.
      const validationResult = await this.validateRoleRemoval(interaction, role, targetUser);
      
      // We ensure we have a valid validation result
      if (!validationResult || !validationResult.valid) {
        const errorMessage = validationResult?.message || ERROR_MESSAGES.UNEXPECTED_ERROR;
        await interaction.editReply({
          content: errorMessage,
          ephemeral: true
        });
        return;
      }
      
      // We remove the role from the user after validation passes.
      const { targetMember } = validationResult;
      await this.removeRoleFromMember(interaction, targetMember, role, reason);
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'takerole', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "INSUFFICIENT_PERMISSIONS") {
      errorMessage = ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS;
    } else if (error.message === "MANAGED_ROLE") {
      errorMessage = ERROR_MESSAGES.MANAGED_ROLE;
    } else if (error.message === "USER_NOT_FOUND") {
      errorMessage = ERROR_MESSAGES.USER_NOT_FOUND;
    } else if (error.message === "ROLE_NOT_ASSIGNED") {
      errorMessage = ERROR_MESSAGES.ROLE_NOT_ASSIGNED;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for takerole command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // We silently catch if all error handling attempts fail.
      });
    }
  },

  /**
   * Validates that the role can be removed from the user.
   * @async
   * @function validateRoleRemoval
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {import('discord.js').Role} role - The role to be removed
   * @param {import('discord.js').User} targetUser - The user to remove the role from
   * @returns {Promise<Object>} Validation result with success status and message
   */
  async validateRoleRemoval(interaction, role, targetUser) {
    // We check if the bot has permission to manage roles in the server.
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      logger.warn("Bot lacks ManageRoles permission:", {
        guildId: interaction.guildId,
        botId: interaction.client.user.id
      });
      return {
        valid: false,
        message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS
      };
    }

    // We check if the role is managed (bot or integration role).
    if (role.managed) {
      logger.warn("Attempted to remove a managed role:", {
        roleId: role.id,
        roleName: role.name
      });
      return {
        valid: false,
        message: ERROR_MESSAGES.MANAGED_ROLE
      };
    }
    
    // We fetch the target member from the guild to access their roles.
    const targetMember = await this.fetchGuildMember(interaction, targetUser.id);
    
    if (!targetMember) {
      return {
        valid: false,
        message: ERROR_MESSAGES.USER_NOT_FOUND
      };
    }

    // We check if the user actually has the role that needs to be removed.
    if (!targetMember.roles.cache.has(role.id)) {
      logger.debug("User does not have the role:", {
        userId: targetUser.id,
        roleId: role.id
      });

      return {
        valid: false,
        message: ERROR_MESSAGES.DISCORD_ROLE_NOT_ASSIGNED
      };
    }
    
    // We check if the bot's highest role is higher than the role to be removed.
    const botMember = interaction.guild.members.me;
    if (botMember.roles.highest.position <= role.position) {
      logger.warn("Bot's highest role is not high enough to remove the specified role:", {
        botRolePosition: botMember.roles.highest.position,
        targetRolePosition: role.position
      });
      
      return {
        valid: false,
        message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS
      };
    }
    
    // We check role hierarchy for the user issuing the command to enforce Discord's role hierarchy rules.
    // Server owners can manage any role regardless of hierarchy.
    if (interaction.guild.ownerId !== interaction.user.id) {
      const executorMember = await this.fetchGuildMember(interaction, interaction.user.id);
      if (executorMember && executorMember.roles.highest.position <= role.position) {
        logger.warn("User attempted to remove a role higher than their highest role:", {
          userRolePosition: executorMember.roles.highest.position,
          targetRolePosition: role.position
        });
        
        return {
          valid: false,
          message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS
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
   * @async
   * @function removeRoleFromMember
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {import('discord.js').GuildMember} targetMember - The member to remove the role from
   * @param {import('discord.js').Role} role - The role to be removed
   * @param {string|null} reason - The reason for removing the role
   */
  async removeRoleFromMember(interaction, targetMember, role, reason) {
    // We format the audit log reason to include the executor and optional custom reason.
    const customReason = reason ? `: "${reason}"` : '';
    const auditReason = `Role removed by ${interaction.user.tag} using takerole command${customReason}`;
    
    // We remove the role from the user with the formatted audit reason.
    await targetMember.roles.remove(role, auditReason);
    
    logger.info("Role successfully removed:", {
      userId: targetMember.id,
      roleId: role.id,
      roleName: role.name
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
   * @async
   * @function fetchGuildMember
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {string} userId - The ID of the user to fetch
   * @returns {Promise<import('discord.js').GuildMember|null>} The guild member or null if not found
   */
  async fetchGuildMember(interaction, userId) {
    try {
      return await interaction.guild.members.fetch(userId);
    } catch (error) {
      logger.warn("Target user not found in guild:", {
        userId: userId,
        guildId: interaction.guildId
      });
      return null;
    }
  }
};