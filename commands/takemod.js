const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue } = require('../utils/database');

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} success - Whether the validation was successful
 * @property {string} [message] - Error message if validation failed
 */

/**
 * @typedef {Object} RoleUpdateResult
 * @property {boolean} success - Whether the role update was successful
 * @property {string} [message] - Error message if role update failed
 */

/**
 * Command module for removing moderator permissions from a role.
 * Removes all permissions from the specified role.
 * @type {Object}
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('takemod')
        .setDescription('Remove moderator permissions from a user\'s role and remove the help role.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('What user should have moderator permissions removed?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    /**
     * Executes the take mod command.
     * This function:
     * 1. Gets the target user
     * 2. Finds the user's role above the configured position
     * 3. Removes all permissions from that role
     * 4. Removes the help role from the user
     * 5. Sends a confirmation embed
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @throws {Error} If there's an error updating the role
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        await interaction.deferReply();
        logger.info("/takemod command initiated:", { 
            userId: interaction.user.id, 
            guildId: interaction.guildId 
        });
        
        try {
            const targetUser = interaction.options.getUser('user');
            
            if (!targetUser) {
                return await interaction.editReply({
                    content: "⚠️ Please provide a valid user.",
                    ephemeral: true
                });
            }
            
            // Fetch the target member
            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            
            if (!targetMember) {
                return await interaction.editReply({
                    content: "⚠️ The specified user was not found in this server.",
                    ephemeral: true
                });
            }
            
            // Get the position above role ID from the database
            const positionAboveRoleId = await getValue('perms_position_above_role');
            
            if (!positionAboveRoleId) {
                return await interaction.editReply({
                    content: "⚠️ The position reference role is not configured. Please set 'perms_position_above_role' in the database.",
                    ephemeral: true
                });
            }
            
            const positionRole = await interaction.guild.roles.fetch(positionAboveRoleId).catch(() => null);
            if (!positionRole) {
                return await interaction.editReply({
                    content: `⚠️ The reference role (ID: ${positionAboveRoleId}) was not found in this server.`,
                    ephemeral: true
                });
            }
            
            // Find the user's role that is positioned above the reference role
            const userRoleAbovePosition = targetMember.roles.cache
                .filter(role => role.position > positionRole.position)
                .sort((a, b) => b.position - a.position)
                .first();
            
            if (!userRoleAbovePosition) {
                return await interaction.editReply({
                    content: `⚠️ The user doesn't have a role positioned above the reference role (${positionRole.name}).`,
                    ephemeral: true
                });
            }
            
            // Get the help role ID from the database
            const helpRoleId = await getValue('help_role');
            
            if (!helpRoleId) {
                return await interaction.editReply({
                    content: "⚠️ The help role is not configured. Please set 'help_role' in the database.",
                    ephemeral: true
                });
            }
            
            // Fetch the help role
            const helpRole = await interaction.guild.roles.fetch(helpRoleId).catch(() => null);
            
            if (!helpRole) {
                return await interaction.editReply({
                    content: `⚠️ The help role (ID: ${helpRoleId}) was not found in this server.`,
                    ephemeral: true
                });
            }
            
            logger.debug("Processing command:", { 
                targetUserId: targetUser.id,
                userRoleId: userRoleAbovePosition.id, 
                userRoleName: userRoleAbovePosition.name,
                helpRoleId: helpRoleId,
                helpRoleName: helpRole.name
            });
            
            // Remove all permissions from the user's role
            const roleUpdateResult = await this.updateRolePermissions(interaction, userRoleAbovePosition);
            if (!roleUpdateResult.success) {
                return await interaction.editReply({
                    content: roleUpdateResult.message,
                    ephemeral: true
                });
            }
            
            // Remove the help role from the user
            if (targetMember.roles.cache.has(helpRole.id)) {
                const auditReason = `Help role removed by ${interaction.user.tag} (ID: ${interaction.user.id}) using takemod command`;
                await targetMember.roles.remove(helpRole.id, auditReason);
                
                logger.info("Help role removed from user:", {
                    userId: targetUser.id,
                    helpRoleId: helpRole.id,
                    helpRoleName: helpRole.name
                });
            }
            
            const embed = new EmbedBuilder()
                .setColor(userRoleAbovePosition.color)
                .setTitle('🔒 Moderator Permissions Removed')
                .setDescription(`Successfully removed moderator permissions from <@${targetUser.id}>!`)
                .addFields(
                    { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Role Updated', value: userRoleAbovePosition.name, inline: true }
                );
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/takemod command completed successfully:", {
              userId: interaction.user.id,
              targetUserId: targetUser.id,
              roleId: userRoleAbovePosition.id,
              roleName: userRoleAbovePosition.name,
              helpRoleId: helpRole.id
            });
                        
        } catch (error) {
            await this.handleError(error, interaction);
        }
    },
    
    /**
     * Validates the command inputs.
     * Checks if role is provided and valid.
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @param {Role} role - The role to be updated
     * @returns {ValidationResult} Object containing validation result
     */
    validateInputs(interaction, role) {
        if (!role) {
            logger.warn("Invalid role provided.");
            return {
                success: false,
                message: "⚠️ Please provide a valid role."
            };
        }
        
        return { success: true };
    },
    
    /**
     * Updates the role to remove all permissions.
     * Checks bot permissions and role hierarchy before updating.
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @param {Role} role - The role to be updated
     * @returns {Promise<RoleUpdateResult>} Object containing role update result
     */
    async updateRolePermissions(interaction, role) {
        const botMember = await interaction.guild.members.fetchMe();
        
        // Check if bot can manage this role
        if (botMember.roles.highest.position <= role.position) {
            logger.warn("Bot's highest role is not high enough to modify the specified role:", {
                botHighestRolePosition: botMember.roles.highest.position,
                rolePosition: role.position
            });
            return {
                success: false,
                message: "⚠️ I don't have permission to modify this role. The role must be below my highest role."
            };
        }
        
        // Check if the user can manage this role
        if (interaction.member.roles.highest.position <= role.position && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            logger.warn("User's highest role is not high enough to modify the specified role:", {
                userHighestRolePosition: interaction.member.roles.highest.position,
                rolePosition: role.position
            });
            return {
                success: false,
                message: "⚠️ You don't have permission to modify this role. The role must be below your highest role."
            };
        }
        
        // Remove all permissions (set to 0)
        const noPermissions = BigInt(0);
        const auditReason = `Moderator permissions removed by ${interaction.user.tag} (ID: ${interaction.user.id}) using takemod command`;
        
        await role.edit({
            permissions: noPermissions,
            reason: auditReason
        });
        
        logger.info("/takemod role updated successfully:", { 
            roleId: role.id, 
            roleName: role.name,
            updatedBy: interaction.user.tag
        });
        
        return { success: true };
    },
    
    /**
     * Handles errors that occur during command execution.
     * Logs the error and sends an appropriate error message to the user.
     * 
     * @param {Error} error - The error that occurred
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @returns {Promise<void>}
     */
    async handleError(error, interaction) {
        logger.error('Error in takemod command:', {
            error: error.message,
            stack: error.stack,
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });

        let errorMessage = "⚠️ An unexpected error occurred while updating the role permissions.";
        
        if (error.message === "INSUFFICIENT_PERMISSIONS") {
            errorMessage = "⚠️ I don't have permission to manage roles.";
        } else if (error.message === "INVALID_ROLE") {
            errorMessage = "⚠️ The specified role is invalid or doesn't exist.";
        } else if (error.message.includes("Missing Permissions")) {
            errorMessage = "⚠️ I don't have permission to modify this role.";
        } else if (error.message.includes("Hierarchy")) {
            errorMessage = "⚠️ I cannot modify this role because it's higher than or equal to my highest role.";
        }

        try {
            await interaction.editReply({ content: errorMessage });
        } catch (replyError) {
            logger.error('Failed to send error message:', {
                error: replyError.message,
                stack: replyError.stack
            });
        }
    }
};

