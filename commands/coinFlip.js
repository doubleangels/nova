const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

// Configuration constants.
const COIN_FACES = {
    HEADS: 'Heads',
    TAILS: 'Tails'
};
const HEADS_PROBABILITY = 0.5;

module.exports = {
    /**
     * Slash command definition for flipping a coin.
     * This command randomly selects either "Heads" or "Tails" and returns the result.
     */
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flips a coin and returns heads or tails.'),

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

            // Generate a random number and determine Heads or Tails.
            const randomValue = Math.random();
            const result = randomValue < HEADS_PROBABILITY ? COIN_FACES.HEADS : COIN_FACES.TAILS;
            
            logger.debug("Coin flip result determined.", {
                result: result,
                randomValue: randomValue
            });

            // Reply to the user with the result (public message).
            await interaction.editReply({ content: `🪙 The coin landed on **${result}**!` });
            
            logger.info("Coinflip command completed successfully.", {
                userId: interaction.user.id,
                result: result
            });
        } catch (error) {
            logger.error("Error executing coinflip command.", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user?.id,
                guildId: interaction.guild?.id
            });
            
            await interaction.editReply({
                content: "⚠️ An unexpected error occurred. Please try again later.",
                ephemeral: true
            });
        }
    }
};
