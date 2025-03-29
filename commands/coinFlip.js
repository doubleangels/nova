const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

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
            await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", flags: MessageFlags.Ephemeral });
        }
    }
};
