const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');

/**
 * Command module for converting messages to mocking text format.
 * @type {Object}
 */
module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Mock')
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(null),

    /**
     * Executes the mocking command.
     * This function:
     * 1. Gets the target message content
     * 2. Converts it to alternating case (mocking format)
     * 3. Sends the converted text as a reply
     * 
     * @param {ContextMenuCommandInteraction} interaction - The interaction that triggered the command
     * @throws {Error} If there's an error processing the message
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const targetMessage = interaction.targetMessage;
            const originalContent = targetMessage.content;
            
            logger.info("/mock context menu command initiated.", {
                userId: interaction.user.id,
                guildId: interaction.guild?.id,
                targetMessageId: targetMessage.id,
                originalLength: originalContent.length
            });

            if (!originalContent || originalContent.trim().length === 0) {
                return await interaction.editReply({
                    content: "⚠️ The selected message has no text content to convert.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (originalContent.length > 2000) {
                return await interaction.editReply({
                    content: "⚠️ The message is too long to convert. Please select a shorter message.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const mockedText = this.convertToMock(originalContent);
            const suffix = ' <a:spongebobmock:1291527476564066387>';

            const embed = new EmbedBuilder()
                .setColor(config.baseEmbedColor ?? 0)
                .setDescription(`${mockedText}${suffix}`)
                .setFooter({ text: `Mocked from ${targetMessage.author.tag}` })
                .setTimestamp(targetMessage.createdAt);
            
            await interaction.followUp({
                embeds: [embed]
            });
            
            logger.info("/mock context menu command completed successfully.", {
                userId: interaction.user.id,
                originalLength: originalContent.length,
                convertedLength: mockedText.length
            });
            
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * Converts text to mocking format (alternating case by character).
     * Example: "Like this" -> "lIkE tHiS"
     * 
     * @param {string} text - The text to convert
     * @returns {string} The converted text in alternating case
     */
    convertToMock(text) {
        let upper = false;

        return Array.from(text).map((ch) => {
            if (/[a-zA-Z]/.test(ch)) {
                const out = upper ? ch.toUpperCase() : ch.toLowerCase();
                upper = !upper;
                return out;
            }
            return ch;
        }).join('');
    },

    /**
     * Handles errors that occur during command execution.
     * Logs the error and sends an appropriate error message to the user.
     * 
     * @param {ContextMenuCommandInteraction} interaction - The interaction that triggered the command
     * @param {Error} error - The error that occurred
     * @returns {Promise<void>}
     */
    async handleError(interaction, error) {
        logger.error("Error occurred in mock context menu command.", {
            err: error,
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            targetMessageId: interaction.targetMessage?.id
        });
        
        let errorMessage = "⚠️ An unexpected error occurred while converting the message. Please try again later.";
        
        if (error.message === "MESSAGE_NOT_FOUND") {
            errorMessage = "⚠️ The selected message could not be found.";
        } else if (error.message === "NO_PERMISSION") {
            errorMessage = "⚠️ You don't have permission to view this message.";
        } else if (error.message === "MESSAGE_TOO_LONG") {
            errorMessage = "⚠️ The message is too long to convert.";
        } else if (error.message === "NO_TEXT_CONTENT") {
            errorMessage = "⚠️ The selected message has no text content to convert.";
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                flags: MessageFlags.Ephemeral 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for mock command.", {
                err: followUpError,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: errorMessage,
                flags: MessageFlags.Ephemeral 
            }).catch(() => {});
        }
    }
};
