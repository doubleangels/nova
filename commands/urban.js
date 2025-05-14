/**
 * We handle the urban command.
 * This function fetches and displays definitions from Urban Dictionary.
 *
 * We perform several tasks:
 * 1. Fetch the definition from Urban Dictionary API
 * 2. Create an embed with the definition details
 * 3. Send the embed to the user
 *
 * @param {Interaction} interaction - The Discord interaction object
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger')('urban.js');

// We use these configuration constants for the Urban Dictionary API.
const URBAN_API_URL = 'https://api.urbandictionary.com/v0/define';
const URBAN_EMBED_COLOR = 0x1DB954;
const URBAN_DESCRIPTION_MAX_LENGTH = 1024;
const URBAN_EXAMPLE_MAX_LENGTH = 1024;
const URBAN_REQUEST_TIMEOUT = 10000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('urban')
        .setDescription('Fetch and display definitions from Urban Dictionary.')
        .addStringOption(option =>
            option.setName('term')
                .setDescription('The term to look up')
                .setRequired(true)),

    async execute(interaction) {
        try {
            // We defer the reply since the API call might take a moment.
            await interaction.deferReply();
            
            // We get the search term from the interaction options.
            const term = interaction.options.getString('term');
            
            logger.info("Urban Dictionary command initiated.", {
                userId: interaction.user.id,
                guildId: interaction.guild?.id,
                term
            });

            // We fetch the definition from Urban Dictionary.
            const response = await axios.get(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`);
            const definitions = response.data.list;

            if (!definitions || definitions.length === 0) {
                // We inform the user if no definition was found.
                await interaction.editReply({
                    content: `We couldn't find a definition for "${term}".`,
                    ephemeral: true
                });
                return;
            }

            // We get the first definition and create an embed.
            const definition = definitions[0];
            const embed = new EmbedBuilder()
                .setColor('#1DB954')
                .setTitle(`Urban Dictionary: ${definition.word}`)
                .setDescription(definition.definition)
                .addFields(
                    { name: 'Example', value: definition.example || 'No example provided.' },
                    { name: 'Author', value: definition.author },
                    { name: '👍', value: definition.thumbs_up.toString(), inline: true },
                    { name: '👎', value: definition.thumbs_down.toString(), inline: true }
                )
                .setFooter({ text: 'Powered by Urban Dictionary' });
            
            // We send the embed to the user.
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("Urban Dictionary command completed successfully.", {
                userId: interaction.user.id,
                term
            });
        } catch (error) {
            logger.error("Error executing urban command:", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user?.id
            });
            
            // We inform the user if something goes wrong.
            await interaction.editReply({
                content: "⚠️ We couldn't fetch the definition. Please try again later.",
                ephemeral: true
            });
        }
    },

    /**
     * Truncates text to a maximum length and adds ellipsis if needed.
     * @param {string} text - The text to truncate.
     * @param {number} maxLength - The maximum length allowed.
     * @returns {string} The truncated text.
     */
    truncateText(text, maxLength) {
        if (!text) return 'No example provided.';
        return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
    },

    /**
     * Handles errors that occur during command execution.
     * @param {CommandInteraction} interaction - The interaction that triggered the command.
     * @param {Error} error - The error that occurred.
     */
    async handleError(interaction, error) {
        logger.error('Urban Dictionary command error:', {
            error: error.message,
            userId: interaction.user.id,
            guildId: interaction.guildId
        });

        let errorMessage = 'We encountered an error while fetching the definition.';
        
        if (error.code === 'ECONNABORTED') {
            errorMessage = 'The request to Urban Dictionary timed out. Please try again later.';
        } else if (error.response) {
            if (error.response.status === 429) {
                errorMessage = 'We\'ve hit the rate limit for Urban Dictionary. Please try again later.';
            } else if (error.response.status >= 500) {
                errorMessage = 'Urban Dictionary is currently experiencing issues. Please try again later.';
            }
        }

        await interaction.editReply({ content: errorMessage });
    }
};