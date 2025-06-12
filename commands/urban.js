const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger')('urban.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('urban')
        .setDescription('Fetch and display definitions from Urban Dictionary.')
        .addStringOption(option =>
            option.setName('term')
                .setDescription('What do you want to search for?')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const term = interaction.options.getString('term');
            
            logger.info("/urban command initiated:", {
                userId: interaction.user.id,
                guildId: interaction.guildId
            });

            const response = await axios.get(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`, {
                timeout: 10000
            });
            const definitions = response.data.list;

            if (!definitions || definitions.length === 0) {
                await interaction.editReply({
                    content: "⚠️ No definitions found for that term.",
                    ephemeral: true
                });
                return;
            }

            const definition = definitions[0];
            const embed = new EmbedBuilder()
                .setColor(0x202C34)
                .setTitle(`Urban Dictionary: ${definition.word}`)
                .setDescription(definition.definition)
                .addFields(
                    { name: 'Example', value: definition.example || 'No example provided.' },
                    { name: 'Author', value: definition.author },
                    { name: '👍', value: definition.thumbs_up.toString(), inline: true },
                    { name: '👎', value: definition.thumbs_down.toString(), inline: true }
                )
                .setFooter({ text: 'Powered by Urban Dictionary' });
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/urban command completed successfully:", {
                userId: interaction.user.id,
                term
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    async handleError(interaction, error) {
        logger.error("Error in urban command:", {
            error: error.message,
            stack: error.stack,
            userId: interaction.user?.id,
            guildId: interaction.guild?.id
        });
        
        let errorMessage = "⚠️ An unexpected error occurred while searching Urban Dictionary.";
        
        if (error.message === "API_ERROR") {
            errorMessage = "⚠️ Failed to search Urban Dictionary. Please try again later.";
        } else if (error.message === "RATE_LIMIT") {
            errorMessage = "⚠️ Rate limit exceeded. Please try again in a few minutes.";
        } else if (error.message === "NETWORK_ERROR") {
            errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
        } else if (error.message === "NO_RESULTS") {
            errorMessage = "⚠️ No definitions found for your search term.";
        } else if (error.message === "INVALID_TERM") {
            errorMessage = "⚠️ Please provide a valid search term.";
        }
        
        try {
            await interaction.editReply({ 
                content: errorMessage,
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for urban command:", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: errorMessage,
                ephemeral: true 
            }).catch(() => {});
        }
    }
};