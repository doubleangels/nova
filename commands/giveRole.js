const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Module for the /giverole command.
 * This command assigns a specified role to a specified user in the server.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('giverole')
        .setDescription('Gives a specified role to a user.')
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
     * Executes the /giverole command.
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // We defer the reply since role assignment might take a moment to complete.
        await interaction.deferReply();
        logger.info(`/giverole command initiated.`, { 
            userId: interaction.user.id, 
            guildId: interaction.guild.id 
        });
        
        try {
            // We extract the command options provided by the user.
            const role = interaction.options.getRole('role');
            const targetUser = interaction.options.getUser('user');
            
            logger.debug("Processing command options.", { 
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
            // We log the full error with stack trace for debugging purposes.
            logger.error("Error executing /giverole command.", { 
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guild.id
            });
            await interaction.editReply({
                content: this.getErrorMessage(error),
                ephemeral: true
            });
        }
    },
    
    /**
     * Validates that the role assignment can be performed by checking permissions and conditions.
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {Role} role - The role to assign.
     * @param {User} targetUser - The user to receive the role.
     * @returns {Object} An object with success status, message, and targetMember if successful.
     */
    async validateRoleAssignment(interaction, role, targetUser) {
        // We check if the bot has permission to manage roles in the server.
        const botMember = await interaction.guild.members.fetchMe();
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            logger.warn("Bot lacks ManageRoles permission.", { 
                guildId: interaction.guild.id
            });
            return {
                success: false,
                message: "⚠️ I don't have permission to manage roles in this server."
            };
        }

        // We check if the bot's highest role is above the role being assigned in the hierarchy.
        if (role.position >= botMember.roles.highest.position) {
            logger.warn("Bot's highest role is not high enough to assign the specified role.", {
                roleId: role.id,
                roleName: role.name,
                botHighestRolePosition: botMember.roles.highest.position,
                rolePosition: role.position
            });
            return {
                success: false,
                message: "⚠️ I can't assign this role because it's higher than or equal to my highest role."
            };
        }
        
        // We check role hierarchy for the user issuing the command to enforce Discord's role hierarchy rules.
        const issuerMember = await interaction.guild.members.fetch(interaction.user.id);
        const issuerHighestRole = issuerMember.roles.highest;
        if (role.position >= issuerHighestRole.position && interaction.guild.ownerId !== interaction.user.id) {
            logger.warn("User attempted to assign a role higher than their highest role.", {
                userId: interaction.user.id,
                roleId: role.id,
                userHighestRoleId: issuerHighestRole.id
            });
            return {
                success: false,
                message: "⚠️ You don't have permission to assign a role higher than your highest role."
            };
        }
        
        // We fetch the target member from the guild to ensure they exist.
        let targetMember;
        try {
            targetMember = await interaction.guild.members.fetch(targetUser.id);
        } catch (e) {
            logger.warn("Target user not found in guild.", { 
                targetUserId: targetUser.id
            });
            return {
                success: false,
                message: "⚠️ The specified user could not be found in this server."
            };
        }
        
        // We check if the user already has the role to avoid redundant assignments.
        const hasRole = targetMember.roles.cache.has(role.id);
        if (hasRole) {
            logger.debug("User already has the role.", {
                userId: targetUser.id,
                roleId: role.id
            });
            return {
                success: false,
                message: `⚠️ ${targetUser} already has the ${role} role.`
            };
        }
        
        return {
            success: true,
            targetMember: targetMember
        };
    },
    
    /**
     * Assigns a role to a guild member with an audit log reason.
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {GuildMember} targetMember - The member to receive the role.
     * @param {Role} role - The role to assign.
     */
    async assignRole(interaction, targetMember, role) {
        const auditReason = `Role assigned by ${interaction.user.tag} (ID: ${interaction.user.id}) using giverole command.`;
        await targetMember.roles.add(role, auditReason);
        
        logger.info("Role successfully assigned.", { 
            roleId: role.id, 
            roleName: role.name,
            targetUserId: targetMember.user.id,
            targetUserTag: targetMember.user.tag,
            assignedBy: interaction.user.id,
            assignedByTag: interaction.user.tag,
            guildId: interaction.guild.id
        });
    },
    
    /**
     * Gets a user-friendly error message based on the error type.
     * @param {Error} error - The error object.
     * @returns {string} A user-friendly error message explaining the issue.
     */
    getErrorMessage(error) {
        if (error.code === 50013) {
            return "⚠️ I don't have permission to manage roles. Please check my permissions.";
        } else if (error.message.includes('Missing Access')) {
            return "⚠️ I don't have access to manage this role. Please check my permissions.";
        } else if (error.message.includes('rate limit')) {
            return "⚠️ Discord is currently rate limiting this action. Please try again in a few moments.";
        }
        return "⚠️ An unexpected error occurred. Please try again later.";
    }
};