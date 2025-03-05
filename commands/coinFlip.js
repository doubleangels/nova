const { SlashCommandBuilder } = require('discord.js');
const logger = require('../logger')('coinFlip.js');

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
        try {
            logger.debug("Coinflip command received:", {
                user: interaction.user.tag,
                userId: interaction.user.id,
                guild: interaction.guild?.name,
                guildId: interaction.guild?.id,
                channel: interaction.channel?.name
            });

            // Generate a random number and determine Heads or Tails
            const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
            
            logger.debug("Coin flip result generated:", {
                result: result,
                randomValue: Math.random()
            });

            // Reply to the user with the result (public message)
            await interaction.reply({ content: `🪙 The coin landed on **${result}**!` });
            
            logger.info("Coinflip command executed successfully:", {
                user: interaction.user.tag,
                result: result
            });
        } catch (error) {
            logger.error("Error executing coinflip command:", {
                error: error.message,
                stack: error.stack,
                user: interaction.user?.tag,
                guild: interaction.guild?.name
            });
            
            // Attempt to send an error response to the user
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: "An error occurred while flipping the coin.",
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                logger.error("Error sending error response:", {
                    error: replyError.message
                });
            }
        }
    }
};
