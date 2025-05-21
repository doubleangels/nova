const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

/**
 * We handle the giverole command.
 * This function assigns a specified role to a specified user in the server.
 *
 * We perform several tasks:
 * 1. We validate permissions and role hierarchy.
 * 2. We check if the user already has the role.
 * 3. We assign the role to the user.
 * 4. We handle errors and provide user feedback.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('giverole')
        .setDescription('Assign a specified role to a user in the server.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('What role would you like to assign?')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Which user should receive this role?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    /**
     * We execute the /giverole command.
     * This function processes the role assignment request.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // We defer the reply since role assignment might take a moment to complete.
        await interaction.deferReply();
        logger.info("/giverole command initiated:", { 
            userId: interaction.user.id, 
            guildId: interaction.guild.id 
        });
        
        try {
            // We extract the command options provided by the user.
            const role = interaction.options.getRole('role');
            const targetUser = interaction.options.getUser('user');
            
            logger.debug("Processing command options:", { 
                roleId: role.id,
                roleName: role.name,
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag
            });
            
            // We validate permissions and conditions before attempting role assignment.
            const validationResult = await this.validateRoleAssignment(interaction, role, targetUser);
            if (!validationResult.success) {
                return await interaction.editReply({
                    content: validationResult.message,
                    ephemeral: true
                });
            }
            
            // We add the role to the user after validation passes.
            const targetMember = validationResult.targetMember;
            await this.assignRole(interaction, targetMember, role);
            await interaction.editReply({
                content: `✅ Successfully gave the ${role} role to ${targetUser}!`
            });
            
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },
    
    /**
     * We handle errors that occur during command execution.
     * This function logs the error and attempts to notify the user.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {Error} error - The error that occurred.
     */
    async handleError(interaction, error) {
        logError(error, 'giverole', {
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
        } else if (error.message === "ROLE_ALREADY_ASSIGNED") {
            errorMessage = ERROR_MESSAGES.ROLE_ALREADY_ASSIGNED;
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for giverole command:", {
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
     * We validate that the role assignment can be performed by checking permissions and conditions.
     * This function checks bot and user permissions, role hierarchy, and if the user already has the role.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {Role} role - The role to assign.
     * @param {User} targetUser - The user to receive the role.
     * @returns {Object} An object with success status, message, and targetMember if successful.
     */
    async validateRoleAssignment(interaction, role, targetUser) {
        // We check if the bot has permission to manage roles in the server.
        const botMember = await interaction.guild.members.fetchMe();
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            logger.warn("Bot lacks ManageRoles permission:", { 
                guildId: interaction.guild.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS
            };
        }

        // We check if the role is managed (bot or integration role).
        if (role.managed) {
            logger.warn("Attempted to assign a managed role:", {
                roleId: role.id,
                roleName: role.name
            });
            return {
                success: false,
                message: ERROR_MESSAGES.MANAGED_ROLE
            };
        }

        // We check if the bot's highest role is above the role being assigned in the hierarchy.
        if (role.position >= botMember.roles.highest.position) {
            logger.warn("Bot's highest role is not high enough to assign the specified role:", {
                roleId: role.id,
                roleName: role.name,
                botHighestRolePosition: botMember.roles.highest.position,
                rolePosition: role.position
            });
            return {
                success: false,
                message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS
            };
        }
        
        // We check role hierarchy for the user issuing the command to enforce Discord's role hierarchy rules.
        // Server owners can manage any role regardless of hierarchy.
        if (interaction.guild.ownerId !== interaction.user.id) {
            const issuerMember = await interaction.guild.members.fetch(interaction.user.id);
            const issuerHighestRole = issuerMember.roles.highest;
            if (role.position >= issuerHighestRole.position) {
                logger.warn("User attempted to assign a role higher than their highest role:", {
                    userId: interaction.user.id,
                    roleId: role.id,
                    userHighestRoleId: issuerHighestRole.id
                });
                return {
                    success: false,
                    message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS
                };
            }
        }
        
        // We fetch the target member from the guild to ensure they exist.
        let targetMember;
        try {
            targetMember = await interaction.guild.members.fetch(targetUser.id);
        } catch (e) {
            logger.warn("Target user not found in guild:", { 
                targetUserId: targetUser.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            };
        }
        
        // We check if the user already has the role to avoid redundant assignments.
        const hasRole = targetMember.roles.cache.has(role.id);
        if (hasRole) {
            logger.debug("User already has the role:", {
                userId: targetUser.id,
                roleId: role.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.ROLE_ALREADY_ASSIGNED
            };
        }
        
        return {
            success: true,
            targetMember: targetMember
        };
    },
    
    /**
     * We assign a role to a guild member with an audit log reason.
     * This function adds the role to the user and logs the action.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {GuildMember} targetMember - The member to receive the role.
     * @param {Role} role - The role to assign.
     */
    async assignRole(interaction, targetMember, role) {
        const auditReason = `Role assigned by ${interaction.user.tag} (ID: ${interaction.user.id}) using giverole command.`;
        await targetMember.roles.add(role, auditReason);
        
        logger.info("Role successfully assigned:", { 
            roleId: role.id, 
            roleName: role.name,
            targetUserId: targetMember.user.id,
            targetUserTag: targetMember.user.tag,
            assignedBy: interaction.user.id,
            assignedByTag: interaction.user.tag,
            guildId: interaction.guild.id
        });
    }
};