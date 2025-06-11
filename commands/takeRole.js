/**
 * Take role command module for removing roles from users.
 * Handles role removal, permission validation, and audit logging.
 * @module commands/takeRole
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { logError } = require('../errors');

const ROLE_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while removing the role.";
const ROLE_ERROR_INSUFFICIENT_PERMISSIONS = "⚠️ You don't have permission to remove this role.";
const ROLE_ERROR_MANAGED_ROLE = "⚠️ Cannot remove a managed role.";
const ROLE_ERROR_USER_NOT_FOUND = "⚠️ The specified user could not be found in this server.";
const ROLE_ERROR_NOT_ASSIGNED = "⚠️ The user does not have this role.";
const ROLE_ERROR_HIERARCHY = "⚠️ Cannot remove a role that is higher than your highest role.";

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
        .setDescription('For what reason would you like to remove this role?')
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
    await interaction.deferReply();
    
    logger.info("/takerole command initiated:", {
      userId: interaction.user.id,
      guildId: interaction.guildId
    });
    
    try {
      const role = interaction.options.getRole('role');
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      
      logger.debug("Processing command options:", {
        targetUser: targetUser.id,
        roleId: role.id
      });
      
      const validationResult = await this.validateRoleRemoval(interaction, role, targetUser);
      
      if (!validationResult || !validationResult.valid) {
        const errorMessage = validationResult?.message || ROLE_ERROR_UNEXPECTED;
        await interaction.editReply({
          content: errorMessage,
          ephemeral: true
        });
        return;
      }
      
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
    
    let errorMessage = "⚠️ An unexpected error occurred while removing the role.";
    
    if (error.message === "INSUFFICIENT_PERMISSIONS") {
      errorMessage = "⚠️ You don't have permission to remove this role.";
    } else if (error.message === "MANAGED_ROLE") {
      errorMessage = "⚠️ Cannot remove a managed role.";
    } else if (error.message === "USER_NOT_FOUND") {
      errorMessage = "⚠️ The specified user could not be found in this server.";
    } else if (error.message === "ROLE_NOT_ASSIGNED") {
      errorMessage = "⚠️ The user does not have this role.";
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
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      logger.warn("Bot lacks ManageRoles permission:", {
        guildId: interaction.guildId,
        botId: interaction.client.user.id
      });
      return {
        valid: false,
        message: "⚠️ You don't have permission to remove this role."
      };
    }

    if (role.managed) {
      logger.warn("Attempted to remove a managed role:", {
        roleId: role.id,
        roleName: role.name
      });
      return {
        valid: false,
        message: "⚠️ Cannot remove a managed role."
      };
    }
    
    const targetMember = await this.fetchGuildMember(interaction, targetUser.id);
    
    if (!targetMember) {
      return {
        valid: false,
        message: "⚠️ The specified user could not be found in this server."
      };
    }

    if (!targetMember.roles.cache.has(role.id)) {
      logger.debug("User does not have the role:", {
        userId: targetUser.id,
        roleId: role.id
      });

      return {
        valid: false,
        message: "⚠️ The user does not have this role."
      };
    }
    
    const botMember = interaction.guild.members.me;
    if (botMember.roles.highest.position <= role.position) {
      logger.warn("Bot's highest role is not high enough to remove the specified role:", {
        botRolePosition: botMember.roles.highest.position,
        targetRolePosition: role.position
      });
      
      return {
        valid: false,
        message: "⚠️ Cannot remove a role that is higher than your highest role."
      };
    }
    
    if (interaction.guild.ownerId !== interaction.user.id) {
      const executorMember = await this.fetchGuildMember(interaction, interaction.user.id);
      if (executorMember && executorMember.roles.highest.position <= role.position) {
        logger.warn("User attempted to remove a role higher than their highest role:", {
          userRolePosition: executorMember.roles.highest.position,
          targetRolePosition: role.position
        });
        
        return {
          valid: false,
          message: "⚠️ Cannot remove a role that is higher than your highest role."
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
    const customReason = reason ? `: "${reason}"` : '';
    const auditReason = `Role removed by ${interaction.user.tag} using takerole command${customReason}`;
    
    await targetMember.roles.remove(role, auditReason);
    
    logger.info("Role successfully removed:", {
      userId: targetMember.id,
      roleId: role.id,
      roleName: role.name
    });
    
    const embed = new EmbedBuilder()
      .setColor(role.color)
      .setTitle('Role Removed')
      .setDescription(`✅ Successfully removed the ${role.name} role from <@${targetMember.id}>!`)
      .addFields(
        { name: 'Role', value: role.name, inline: true },
        { name: 'Role Color', value: `\`${role.hexColor}\``, inline: true }
      )
      .setFooter({ text: `Updated by ${interaction.user.tag}` })
      .setTimestamp();

    if (reason) {
      embed.addFields({ name: 'Reason', value: reason });
    }
    
    await interaction.editReply({ embeds: [embed] });
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