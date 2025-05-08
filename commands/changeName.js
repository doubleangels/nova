const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

module.exports = {
    /**
     * Slash command definition for changing a user's nickname.
     * This command allows users to change their own nickname or moderators to change others' nicknames.
     */
    data: new SlashCommandBuilder()
        .setName('changename')
        .setDescription('Changes a user\'s nickname.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Which user would you like to change the nickname for?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('nickname')
                .setDescription('What would you like to change the nickname to? (Leave blank to reset)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ChangeNickname),

    /**
     * Executes the /changename command.
     * @param {import('discord.js').CommandInteraction} interaction - The interaction object from Discord.
     */
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const targetUser = interaction.options.getUser('user');
            const newNickname = interaction.options.getString('nickname');
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            logger.info("Nickname change command initiated.", {
                userId: interaction.user.id,
                targetUserId: targetUser.id,
                guildId: interaction.guild?.id
            });

            // Check if the user has permission to change the target's nickname
            const permissionCheckResult = await this.checkPermissions(interaction, targetMember);
            if (!permissionCheckResult.success) {
                return await interaction.editReply({
                    content: permissionCheckResult.message,
                    ephemeral: true
                });
            }

            // Store the original nickname for the response
            const originalNickname = targetMember.nickname || targetUser.username;

            // Set the new nickname
            const auditReason = `Nickname changed by ${interaction.user.tag} (ID: ${interaction.user.id}) using changename command.`;
            await targetMember.setNickname(newNickname, auditReason);

            logger.info("Nickname successfully changed.", {
                targetUserId: targetUser.id,
                oldNickname: originalNickname,
                newNickname: newNickname || 'None (reset)',
                changedBy: interaction.user.id
            });

            // Send confirmation message
            const responseMessage = newNickname 
                ? `✅ Successfully updated ${targetUser}'s nickname!`
                : `✅ Successfully reset ${targetUser}'s nickname!`;

            await interaction.editReply({
                content: responseMessage,
                ephemeral: true
            });

        } catch (error) {
            logger.error("Failed to change nickname.", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user?.id,
                targetUserId: targetUser?.id
            });

            await interaction.editReply({
                content: this.getErrorMessage(error),
                ephemeral: true
            });
        }
    },

    /**
     * Checks if the user has permission to change the target's nickname.
     * @param {import('discord.js').CommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').GuildMember} targetMember - The target member whose nickname will be changed.
     * @returns {Object} An object with success status and message.
     */
    async checkPermissions(interaction, targetMember) {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Server owners can change anyone's nickname
        if (interaction.guild.ownerId === interaction.user.id) {
            return { success: true };
        }

        // Users can change their own nickname if they have the permission
        if (targetMember.id === interaction.user.id) {
            if (!member.permissions.has(PermissionFlagsBits.ChangeNickname)) {
                return {
                    success: false,
                    message: "⚠️ You don't have permission to change your own nickname."
                };
            }
            return { success: true };
        }

        // For changing others' nicknames, need ManageNicknames permission
        if (!member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            return {
                success: false,
                message: "⚠️ You don't have permission to change other users' nicknames."
            };
        }

        // Check if the bot has permission to change the target's nickname
        if (!targetMember.manageable) {
            return {
                success: false,
                message: "⚠️ I don't have permission to change this user's nickname. Please check role hierarchy."
            };
        }

        return { success: true };
    },

    /**
     * Gets a user-friendly error message based on the error.
     * @param {Error} error - The error object.
     * @returns {string} A user-friendly error message.
     */
    getErrorMessage(error) {
        if (error.code === 50013) {
            return "⚠️ I don't have permission to change nicknames. Please check role hierarchy and permissions.";
        } else if (error.message.includes('rate limit')) {
            return "⚠️ Discord is currently rate limiting this action. Please try again in a few moments.";
        } else if (error.message.includes('Maximum length')) {
            return "⚠️ The nickname is too long. Discord nicknames must be 32 characters or less.";
        }
        return "⚠️ An unexpected error occurred. Please try again later.";
    }
}; 