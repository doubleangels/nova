/**
 * Give role command module for managing user roles.
 * Handles role assignment and permission validation.
 * @module commands/giveRole
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * We handle the giverole command.
 * This function assigns a specified role to a user.
 *
 * We perform several tasks:
 * 1. We validate command inputs and permissions.
 * 2. We assign the specified role to the target user.
 * 3. We handle errors and provide user feedback.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('giverole')
        .setDescription('Give a role to a user.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to give to the user.')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give the role to.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    async execute(interaction) {
        await interaction.deferReply();
        logger.info("/giverole command initiated:", { 
            userId: interaction.user.id, 
            guildId: interaction.guildId 
        });
        
        try {
            const role = interaction.options.getRole('role');
            const targetUser = interaction.options.getUser('user');
            
            const validationResult = this.validateInputs(interaction, role, targetUser);
            if (!validationResult.success) {
                return await interaction.editReply({
                    content: validationResult.message,
                    ephemeral: true
                });
            }
            
            logger.debug("Processing command options:", { 
                roleId: role.id, 
                roleName: role.name,
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag 
            });
            
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            if (!targetMember) {
                logger.warn("Target user not found in guild:", { targetUserId: targetUser.id });
                return await interaction.editReply({
                    content: "⚠️ The specified user could not be found in this server.",
                    ephemeral: true
                });
            }
            
            const roleAssignmentResult = await this.assignRole(interaction, role, targetMember);
            if (!roleAssignmentResult.success) {
                return await interaction.editReply({
                    content: roleAssignmentResult.message,
                    ephemeral: true
                });
            }
            
            const embed = new EmbedBuilder()
                .setColor(role.color)
                .setTitle('Role Assigned')
                .setDescription(`✅ Successfully gave <@${targetUser.id}> the ${role.name} role!`)
                .addFields(
                    { name: 'Role', value: role.name, inline: true },
                    { name: 'Role ID', value: role.id, inline: true }
                )
                .setFooter({ text: `Updated by ${interaction.user.tag}` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
                        
        } catch (error) {
            await this.handleError(error, interaction);
        }
    },
    
    validateInputs(interaction, role, targetUser) {
        if (!role) {
            logger.warn("Invalid role provided.");
            return {
                success: false,
                message: "⚠️ Please provide a valid role."
            };
        }
        
        if (!targetUser) {
            logger.warn("Invalid user provided.");
            return {
                success: false,
                message: "⚠️ Please provide a valid user."
            };
        }
        
        return { success: true };
    },
    
    async assignRole(interaction, role, targetMember) {
        const botMember = await interaction.guild.members.fetchMe();
        if (botMember.roles.highest.position <= role.position) {
            logger.warn("Bot's highest role is not high enough to assign the specified role.", {
                botHighestRolePosition: botMember.roles.highest.position,
                rolePosition: role.position
            });
            return {
                success: false,
                message: "⚠️ I don't have permission to assign this role."
            };
        }
        
        const auditReason = `Role assigned by ${interaction.user.tag} (ID: ${interaction.user.id}) using giverole command`;
        await targetMember.roles.add(role.id, auditReason);
        
        logger.info("/giverole command completed successfully:", { 
            userId: targetMember.id, 
            userTag: targetMember.user.tag,
            role: role.name,
            roleId: role.id
        });
        
        return { success: true };
    },
    
    async handleError(error, interaction) {
        logger.error('Error in giveRole command:', {
            error: error.message,
            stack: error.stack,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId
        });

        let errorMessage = "⚠️ An unexpected error occurred while giving the role.";
        
        if (error.message === "INSUFFICIENT_PERMISSIONS") {
            errorMessage = "⚠️ I don't have permission to manage roles.";
        } else if (error.message === "INVALID_ROLE") {
            errorMessage = "⚠️ The specified role is invalid or doesn't exist.";
        } else if (error.message === "INVALID_USER") {
            errorMessage = "⚠️ The specified user is invalid or doesn't exist.";
        } else if (error.message === "USER_NOT_FOUND") {
            errorMessage = "⚠️ Could not find the specified user.";
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