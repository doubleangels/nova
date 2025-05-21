const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

/**
 * We handle the changenickname command.
 * This function changes a user's nickname in the server.
 *
 * We perform several tasks:
 * 1. We validate permissions and nickname length.
 * 2. We check if the user has permission to change nicknames.
 * 3. We change the nickname.
 * 4. We handle errors and provide user feedback.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('changenickname')
        .setDescription('Change a user\'s nickname in the server.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Which user\'s nickname should be changed?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('nickname')
                .setDescription('What should the new nickname be?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
    
    /**
     * We execute the /changenickname command.
     * This function processes the nickname change request.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // We defer the reply since nickname changes might take a moment to complete.
        await interaction.deferReply({ ephemeral: true });
        logger.info("/changenickname command initiated.", { 
            userId: interaction.user.id, 
            guildId: interaction.guild.id 
        });
        
        try {
            // We extract the command options provided by the user.
            const targetUser = interaction.options.getUser('user');
            const newNickname = interaction.options.getString('nickname');
            
            logger.debug("Processing command options.", { 
                targetUserId: targetUser.id,
                targetUserTag: targetUser.tag,
                newNickname: newNickname
            });
            
            // We validate permissions and conditions before attempting nickname change.
            const validationResult = await this.validateNicknameChange(interaction, targetUser, newNickname);
            if (!validationResult.success) {
                return await interaction.editReply({
                    content: validationResult.message,
                    ephemeral: true
                });
            }
            
            // We change the nickname after validation passes.
            const targetMember = validationResult.targetMember;
            await targetMember.setNickname(newNickname);
            
            await interaction.editReply({
                content: `✅ Successfully updated ${targetUser}'s nickname.`,
                ephemeral: true
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
        logError(error, 'changenickname', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        try {
            await interaction.editReply({ 
                content: getErrorMessage(error),
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for changenickname command.", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: getErrorMessage(error),
                ephemeral: true 
            }).catch(() => {
                // We silently catch if all error handling attempts fail.
            });
        }
    },
    
    /**
     * We validate that the nickname change can be performed.
     * This function checks bot and user permissions, nickname length, and role hierarchy.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {User} targetUser - The user whose nickname will be changed.
     * @param {string} newNickname - The new nickname to set.
     * @returns {Object} An object with success status, message, and targetMember if successful.
     */
    async validateNicknameChange(interaction, targetUser, newNickname) {
        // We check if the bot has permission to manage nicknames in the server.
        const botMember = await interaction.guild.members.fetchMe();
        if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            logger.warn("Bot lacks ManageNicknames permission.", { 
                guildId: interaction.guild.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.CHANGENICKNAME_INSUFFICIENT_PERMISSIONS
            };
        }

        // We check if the nickname length exceeds Discord's limit of 32 characters.
        if (newNickname.length > 32) {
            logger.warn("Nickname exceeds maximum length.", {
                length: newNickname.length
            });
            return {
                success: false,
                message: ERROR_MESSAGES.CHANGENICKNAME_TOO_LONG
            };
        }

        // We check if the target user is the server owner.
        if (targetUser.id === interaction.guild.ownerId) {
            logger.warn("Attempted to change server owner's nickname.", {
                targetUserId: targetUser.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.CHANGENICKNAME_OWNER
            };
        }

        // We check if the target user is the bot itself.
        if (targetUser.id === interaction.client.user.id) {
            logger.warn("Attempted to change bot's nickname.", {
                targetUserId: targetUser.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.CHANGENICKNAME_BOT
            };
        }

        // We check role hierarchy for the user issuing the command.
        // Server owners can manage any nickname regardless of hierarchy.
        if (interaction.guild.ownerId !== interaction.user.id) {
            const issuerMember = await interaction.guild.members.fetch(interaction.user.id);
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            if (targetMember.roles.highest.position >= issuerMember.roles.highest.position) {
                logger.warn("User attempted to change nickname of user with higher or equal role.", {
                    userId: interaction.user.id,
                    targetUserId: targetUser.id
                });
                return {
                    success: false,
                    message: ERROR_MESSAGES.CHANGENICKNAME_ROLE_HIERARCHY
                };
            }
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
                message: ERROR_MESSAGES.USER_NOT_FOUND
            };
        }

        return {
            success: true,
            targetMember
        };
    }
}; 