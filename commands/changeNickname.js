const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} success - Whether the validation was successful
 * @property {string} [message] - Error message if validation failed
 * @property {GuildMember} [targetMember] - The target member if validation succeeded
 */

/**
 * Command module for changing user nicknames.
 * @type {Object}
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
     * Executes the nickname change command.
     * This function:
     * 1. Validates bot permissions and user manageability
     * 2. Changes the target user's nickname
     * 3. Sends a confirmation embed with the result
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @throws {Error} If there's an error changing the nickname, with specific error messages for different failure cases
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const targetUser = interaction.options.getUser('user');
            const newNickname = interaction.options.getString('nickname');
            
            // Check cache before fetching member
            let member = interaction.guild.members.cache.get(targetUser.id);
            if (!member) {
                member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            }
            
            if (!member) {
                return await interaction.editReply({
                    content: "⚠️ The specified user could not be found in this server.",
                    flags: MessageFlags.Ephemeral
                });
            }
            
            logger.info("/changenickname command initiated.", {
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

            const oldNickname = member.nickname ?? targetUser.username;
            await member.setNickname(newNickname || null);

            const userHighestRole = member.roles.highest;
            const embedColor = userHighestRole.color === 0 ? config.baseEmbedColor : userHighestRole.color;

            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle('Nickname Updated')
                .setDescription(newNickname
                    ? `Successfully changed ${targetUser}'s nickname from **${oldNickname}** to **${newNickname}**.`
                    : `Successfully reset ${targetUser}'s nickname from **${oldNickname}**.`);
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/changenickname command completed successfully.", {
                targetUserId: targetUser.id,
                newNickname: newNickname || 'reset'
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * Handles errors that occur during command execution.
     * Logs the error and sends an appropriate error message to the user.
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @param {Error} error - The error that occurred
     * @returns {Promise<void>}
     */
    async handleError(interaction, error) {
        logger.error("Error occurred in changenickname command.", {
            err: error,
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            targetUserId: interaction.options?.getUser('user')?.id
        });
        
        let errorMessage = "⚠️ An unexpected error occurred while changing the nickname.";
        
        if (error.message === "BOT_PERMISSION_DENIED") {
            errorMessage = "⚠️ I don't have permission to manage nicknames in this server.";
        } else if (error.message === "USER_NOT_MANAGEABLE") {
            errorMessage = "⚠️ I cannot modify this user's nickname.";
        } else if (error.message === "INVALID_NICKNAME_LENGTH") {
            errorMessage = "⚠️ Nickname must be between 1 and 32 characters.";
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                flags: MessageFlags.Ephemeral 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for change nickname command.", {
                err: followUpError,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: errorMessage,
                flags: MessageFlags.Ephemeral 
            }).catch(() => {
            });
        }
    }
}; 