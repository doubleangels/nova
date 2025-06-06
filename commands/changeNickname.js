/**
 * Change nickname command module for modifying user nicknames.
 * Handles permission checks, nickname validation, and user updates.
 * @module commands/changeNickname
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
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
        .setDescription('Change a user\'s nickname.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('What user do you want to change the nickname of?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('nickname')
                .setDescription('What nickname do you want to set?')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
    
    /**
     * Executes the change nickname command.
     * @async
     * @function execute
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @throws {Error} If nickname update fails or user is not manageable
     */
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const targetUser = interaction.options.getUser('user');
            const newNickname = interaction.options.getString('nickname');
            const member = await interaction.guild.members.fetch(targetUser.id);
            
            logger.info("Change nickname command initiated:", {
                userId: interaction.user.id,
                guildId: interaction.guild.id,
                targetUserId: targetUser.id,
                newNickname
            });

            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                throw new Error("BOT_PERMISSION_DENIED");
            }

            if (!member.manageable) {
                throw new Error("USER_NOT_MANAGEABLE");
            }

            if (newNickname && (newNickname.length < 1 || newNickname.length > 32)) {
                throw new Error("INVALID_NICKNAME_LENGTH");
            }

            await member.setNickname(newNickname || null);
            
            const userHighestRole = member.roles.highest;
            const embedColor = userHighestRole.color === 0 ? '#cd41ff' : userHighestRole.color;
            
            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle('Nickname Updated')
                .setDescription(newNickname 
                    ? `Successfully changed ${targetUser}'s nickname to "${newNickname}!"`
                    : `Successfully reset ${targetUser}'s nickname!`)
                .setFooter({ text: `Updated by ${interaction.user.tag}` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("Nickname updated successfully:", {
                targetUserId: targetUser.id,
                newNickname: newNickname || 'reset'
            });
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
        logError(error, 'changenickname', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            targetUserId: interaction.options?.getUser('user')?.id
        });
        
        let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
        
        if (error.message === "BOT_PERMISSION_DENIED") {
            errorMessage = ERROR_MESSAGES.BOT_MISSING_PERMISSIONS;
        } else if (error.message === "USER_NOT_MANAGEABLE") {
            errorMessage = ERROR_MESSAGES.USER_NOT_MANAGEABLE;
        } else if (error.message === "INVALID_NICKNAME_LENGTH") {
            errorMessage = ERROR_MESSAGES.INVALID_NICKNAME_LENGTH;
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for change nickname command:", {
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
     * We validate that the nickname change can be performed.
     * This function checks bot and user permissions, nickname length, and role hierarchy.
     *
     * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
     * @param {User} targetUser - The user whose nickname will be changed.
     * @param {string} newNickname - The new nickname to set.
     * @returns {Object} An object with success status, message, and targetMember if successful.
     */
    async validateNicknameChange(interaction, targetUser, newNickname) {
        const botMember = await interaction.guild.members.fetchMe();
        if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            logger.warn("Bot lacks ManageNicknames permission:", { 
                guildId: interaction.guild.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.CHANGENICKNAME_INSUFFICIENT_PERMISSIONS
            };
        }

        if (newNickname.length > 32) {
            logger.warn("Nickname exceeds maximum length:", {
                length: newNickname.length
            });
            return {
                success: false,
                message: ERROR_MESSAGES.CHANGENICKNAME_TOO_LONG
            };
        }

        if (targetUser.id === interaction.guild.ownerId) {
            logger.warn("Attempted to change server owner's nickname:", {
                targetUserId: targetUser.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.CHANGENICKNAME_OWNER
            };
        }

        if (targetUser.id === interaction.client.user.id) {
            logger.warn("Attempted to change bot's nickname:", {
                targetUserId: targetUser.id
            });
            return {
                success: false,
                message: ERROR_MESSAGES.CHANGENICKNAME_BOT
            };
        }

        if (interaction.guild.ownerId !== interaction.user.id) {
            const issuerMember = await interaction.guild.members.fetch(interaction.user.id);
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            if (targetMember.roles.highest.position >= issuerMember.roles.highest.position) {
                logger.warn("User attempted to change nickname of user with higher or equal role:", {
                    userId: interaction.user.id,
                    targetUserId: targetUser.id
                });
                return {
                    success: false,
                    message: ERROR_MESSAGES.CHANGENICKNAME_ROLE_HIERARCHY
                };
            }
        }

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

        return {
            success: true,
            targetMember
        };
    }
}; 