const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Command module for flipping a coin.
 * @type {Object}
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin and get heads or tails'),

    /**
     * Executes the coin flip command.
     * This function:
     * 1. Generates a random coin flip result
     * 2. Creates and sends an embed with the result
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @throws {Error} If there's an error during command execution
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            logger.info("/coinflip command initiated:", {
                userId: interaction.user.id,
                guildId: interaction.guild?.id
            });

            const result = this.flipCoin();
            
            const embed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('Coin Flip')
                .setDescription(`🪙 The coin landed on: **${result}**`);
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/coinflip command completed successfully:", {
                userId: interaction.user.id,
                result
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * Generates a random coin flip result.
     * 
     * @returns {string} Either 'Heads' or 'Tails'
     */
    flipCoin() {
        return Math.random() < 0.5 ? 'Heads' : 'Tails';
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
        logger.error("Error in coinflip command:", {
            error: error.message,
            stack: error.stack,
            userId: interaction.user?.id,
            guildId: interaction.guild?.id
        });
        
        let errorMessage = "⚠️ An unexpected error occurred while flipping the coin.";
        
        if (error.message === "RESULT_FAILED") {
            errorMessage = "⚠️ Failed to generate coin flip result.";
        } else if (error.message === "RESPONSE_FAILED") {
            errorMessage = "⚠️ Failed to send coin flip result.";
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for coin flip command:", {
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
    }
};
