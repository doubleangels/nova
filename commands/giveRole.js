/**
 * Give role command module for role management.
 * Handles role assignment and permission validation.
 * @module commands/giveRole
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { logError, ERROR_MESSAGES } = require('../errors');

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
        .setDescription('Give a role to a user.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to give')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give the role to')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    /**
     * Executes the give role command.
     * @async
     * @function execute
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @throws {Error} If role assignment fails
     */
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
                    content: "The specified user could not be found in this server.",
                    ephemeral: true
                });
            }
            
            const botMember = await interaction.guild.members.fetchMe();
            if (botMember.roles.highest.position <= role.position) {
                logger.warn("Bot's highest role is not high enough to assign the role.", {
                    botHighestRolePosition: botMember.roles.highest.position,
                    targetRolePosition: role.position
                });
                return await interaction.editReply({
                    content: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS,
                    ephemeral: true
                });
            }
            
            const auditReason = `Role assigned by ${interaction.user.tag} (ID: ${interaction.user.id}) using giverole command`;
            await targetMember.roles.add(role, auditReason);
            
            logger.info("Role successfully assigned to user:", { 
                userId: targetMember.id, 
                userTag: targetMember.user.tag,
                roleName: role.name,
                roleId: role.id
            });
            
            const embed = new EmbedBuilder()
                .setColor(role.color)
                .setTitle('Role Assigned')
                .setDescription(`✅ Successfully gave the ${role.name} role to <@${targetUser.id}>!`)
                .addFields(
                    { name: 'Role', value: role.name, inline: true },
                    { name: 'Role Color', value: `\`${role.hexColor}\``, inline: true }
                )
                .setFooter({ text: `Updated by ${interaction.user.tag}` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
                        
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },
    
    /**
     * Validates command input parameters.
     * @function validateInputs
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {import('discord.js').Role} role - The role to assign
     * @param {import('discord.js').User} targetUser - The user to receive the role
     * @returns {Object} Validation result with success status and message
     */
    validateInputs(interaction, role, targetUser) {
        if (!role) {
            logger.warn("Invalid role provided.");
            return {
                success: false,
                message: "Please provide a valid role."
            };
        }

        if (!targetUser) {
            logger.warn("Invalid user provided.");
            return {
                success: false,
                message: "Please provide a valid user."
            };
        }
        
        return { success: true };
    },
    
    /**
     * Handles errors that occur during command execution.
     * @async
     * @function handleError
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {Error} error - The error that occurred
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
        } else if (error.message === "ROLE_NOT_FOUND") {
            errorMessage = ERROR_MESSAGES.ROLE_NOT_FOUND;
        } else if (error.message === "USER_NOT_FOUND") {
            errorMessage = ERROR_MESSAGES.USER_NOT_FOUND;
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
            }).catch(() => {});
        }
    }
};