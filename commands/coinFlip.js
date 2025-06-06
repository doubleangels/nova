/**
 * Coin flip command module for simulating coin tosses.
 * Handles random number generation and result display.
 * @module commands/coinFlip
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

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
        .setDescription('Flip a coin and get heads or tails'),

    /**
     * We execute the /coinflip command.
     * This function processes the coin flip request and returns the result.
     *
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @throws {Error} If result generation fails
     */
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            logger.info("Coin flip command initiated:", {
                userId: interaction.user.id,
                guildId: interaction.guild?.id
            });

            const result = this.flipCoin();
            
            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('Coin Flip')
                .setDescription(`The coin landed on: **${result}**`)
                .setThumbnail(result === 'Heads' ? 'https://i.imgur.com/8T9XlFX.png' : 'https://i.imgur.com/4u6o1dy.png')
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("Coin flip completed:", {
                userId: interaction.user.id,
                result
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * Generates a random coin flip result.
     * @function flipCoin
     * @returns {string} Either 'Heads' or 'Tails'
     */
    flipCoin() {
        return Math.random() < 0.5 ? 'Heads' : 'Tails';
    },

    /**
     * We handle errors that occur during command execution.
     * This function logs the error and attempts to notify the user.
     *
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {Error} error - The error that occurred
     */
    async handleError(interaction, error) {
        logError(error, 'coinflip', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id
        });
        
        try {
            await interaction.editReply({ 
                content: ERROR_MESSAGES.UNEXPECTED_ERROR,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for coin flip command:", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: ERROR_MESSAGES.UNEXPECTED_ERROR,
                ephemeral: true 
            }).catch(() => {
            });
        }
    }
};
