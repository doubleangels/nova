const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// These are the configuration constants for the coin flip command.
const COIN_FACE_HEADS = 'Heads';
const COIN_FACE_TAILS = 'Tails';
const HEADS_PROBABILITY = 0.5;
const COIN_EMOJI = '🪙';

/**
 * We handle the coin flip command.
 * This function simulates flipping a coin and provides the result.
 *
 * We perform several tasks:
 * 1. Generate a random result (heads or tails)
 * 2. Format the response with appropriate emojis
 * 3. Send the result to the user
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
    /**
     * Slash command definition for flipping a coin.
     * This command randomly selects either "Heads" or "Tails" and returns the result to the user.
     */
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin and tell you the result.'),

    /**
     * Executes the /coinflip command.
     * @param {import('discord.js').CommandInteraction} interaction - The interaction object from Discord.
     */
    async execute(interaction) {
        await interaction.deferReply();
        try {
            logger.info("Coinflip command initiated.", {
                userId: interaction.user.id,
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id
            });

            // We generate a random number and determine whether the result is Heads or Tails.
            const randomValue = Math.random();
            const result = randomValue < HEADS_PROBABILITY ? COIN_FACE_HEADS : COIN_FACE_TAILS;
            
            logger.debug("Coin flip result determined.", {
                result: result,
                randomValue: randomValue
            });

            // We reply to the user with the result as a public message.
            await interaction.editReply({ 
                content: `${COIN_EMOJI} The coin landed on **${result}**!` 
            });
            
            logger.info("Coinflip command completed successfully.", {
                userId: interaction.user.id,
                result: result
            });
        } catch (error) {
            logger.error("Error executing coinflip command.", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user?.id,
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id
            });
            
            // We send an ephemeral error message to maintain privacy for errors.
            await interaction.editReply({
                content: "⚠️ An unexpected error occurred. Please try again later.",
                ephemeral: true
            });
        }
    }
};
