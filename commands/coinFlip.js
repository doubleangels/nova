const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We define configuration constants for the coin flip command.
const COIN_FACE_HEADS = 'Heads';
const COIN_FACE_TAILS = 'Tails';
const HEADS_PROBABILITY = 0.5;
const COIN_EMOJI = '🪙';

/**
 * We handle the coin flip command.
 * This function simulates flipping a coin and provides the result.
 *
 * We perform several tasks:
 * 1. We generate a random result (heads or tails).
 * 2. We format the response with appropriate emojis.
 * 3. We send the result to the user.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
    /**
     * We define the slash command for flipping a coin.
     * This command randomly selects either "Heads" or "Tails" and returns the result to the user.
     */
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin and return heads or tails.'),

    /**
     * We execute the /coinflip command.
     * This function processes the coin flip request and returns the result.
     *
     * @param {import('discord.js').CommandInteraction} interaction - The interaction object from Discord.
     */
    async execute(interaction) {
        await interaction.deferReply();
        try {
            logger.info("Coinflip command initiated:", {
                userId: interaction.user.id,
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id
            });

            // We generate a random number and determine whether the result is Heads or Tails.
            const randomValue = Math.random();
            const result = randomValue < HEADS_PROBABILITY ? COIN_FACE_HEADS : COIN_FACE_TAILS;
            
            logger.debug("Coin flip result determined:", {
                result: result,
                randomValue: randomValue
            });

            // We reply to the user with the result as a public message.
            await interaction.editReply({ 
                content: `${COIN_EMOJI} The coin landed on **${result}**!` 
            });
            
            logger.info("Coinflip command completed successfully:", {
                userId: interaction.user.id,
                result: result
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
        logError(error, 'coinflip', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for coinflip command:", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: errorMessage,
                ephemeral: true 
            }).catch(() => {
                // We silently catch if all error handling attempts fail.
            });
        }
    }
};
