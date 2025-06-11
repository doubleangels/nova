/**
 * Change nickname command module for modifying user nicknames.
 * Handles permission checks, nickname validation, and user updates.
 * @module commands/changeNickname
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { logError } = require('../errors');

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
        // Early validation of interaction
        if (!interaction || !interaction.isChatInputCommand()) {
            logger.error("Invalid interaction received:", {
                type: interaction?.type,
                userId: interaction?.user?.id
            });
            return;
        }

        let hasResponded = false;
        const respond = async (content, ephemeral = true) => {
            if (hasResponded) return;
            try {
                const options = typeof content === 'string' 
                    ? { content, ephemeral }
                    : { ...content, ephemeral };
                
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply(options);
                } else {
                    await interaction.editReply(options);
                }
                hasResponded = true;
            } catch (error) {
                logger.error("Failed to respond to interaction:", {
                    error: error.message,
                    userId: interaction.user?.id
                });
            }
        };

        try {
            const targetUser = interaction.options.getUser('user');
            const newNickname = interaction.options.getString('nickname');
            
            logger.info("/changenickname command initiated:", {
                userId: interaction.user.id,
                guildId: interaction.guild.id,
                targetUserId: targetUser.id,
                newNickname
            });

            // Validate permissions first
            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                await respond("⚠️ I don't have permission to manage nicknames in this server.");
                return;
            }

            // Fetch member and validate
            let member;
            try {
                member = await interaction.guild.members.fetch(targetUser.id);
            } catch (error) {
                await respond("⚠️ The specified user could not be found in this server.");
                return;
            }

            // Validate member is manageable
            if (!member.manageable) {
                await respond("⚠️ I cannot modify this user's nickname.");
                return;
            }

            // Validate nickname length if provided
            if (newNickname && (newNickname.length < 1 || newNickname.length > 32)) {
                await respond("⚠️ Nickname must be between 1 and 32 characters.");
                return;
            }

            // Attempt to change nickname
            try {
                await member.setNickname(newNickname || null);
            } catch (error) {
                logger.error("Failed to set nickname:", {
                    error: error.message,
                    targetUserId: targetUser.id,
                    newNickname
                });
                await respond("⚠️ Failed to change the nickname. Please try again later.");
                return;
            }
            
            // Create success embed
            const userHighestRole = member.roles.highest;
            const embedColor = userHighestRole.color === 0 ? 0xcd41ff : userHighestRole.color;
            
            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle('Nickname Updated')
                .setDescription(newNickname 
                    ? `Successfully changed ${targetUser}'s nickname to "${newNickname}!"`
                    : `Successfully reset ${targetUser}'s nickname!`)
                .setFooter({ text: `Updated by ${interaction.user.tag}` })
                .setTimestamp();
            
            await respond({ embeds: [embed] }, false);
            
            logger.info("Nickname updated successfully:", {
                targetUserId: targetUser.id,
                newNickname: newNickname || 'reset'
            });
        } catch (error) {
            logError(error, 'changenickname', {
                userId: interaction.user?.id,
                guildId: interaction.guild?.id,
                targetUserId: interaction.options?.getUser('user')?.id
            });
            
            await respond("⚠️ An unexpected error occurred while changing the nickname.");
        }
    }
};