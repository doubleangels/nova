const { SlashCommandBuilder } = require('discord.js');

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
        // Generate a random number and determine Heads or Tails
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';

        // Reply to the user with the result (public message)
        await interaction.reply({ content: `🪙 The coin landed on **${result}**!` });
    }
};
