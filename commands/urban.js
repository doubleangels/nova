/**
 * Module for the /urban command.
 * We fetch and display definitions from Urban Dictionary.
 */

const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const logger = require('../logger');

// We use these configuration constants for the Urban Dictionary API.
const URBAN_API_URL = 'https://api.urbandictionary.com/v0/define';
const URBAN_EMBED_COLOR = 0x1DB954;
const URBAN_DESCRIPTION_MAX_LENGTH = 1024;
const URBAN_EXAMPLE_MAX_LENGTH = 1024;
const URBAN_REQUEST_TIMEOUT = 10000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('urban')
        .setDescription('We look up a term on Urban Dictionary.')
        .addStringOption(option =>
            option.setName('term')
                .setDescription('The term to look up')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();
        const term = interaction.options.getString('term');

        try {
            const response = await axios.get(URBAN_API_URL, {
                params: { term },
                timeout: URBAN_REQUEST_TIMEOUT
            });

            if (!response.data.list || response.data.list.length === 0) {
                return await interaction.editReply({
                    content: `We couldn't find any definitions for "${term}".`
                });
            }

            const definition = response.data.list[0];
            const embed = new EmbedBuilder()
                .setColor(URBAN_EMBED_COLOR)
                .setTitle(definition.word)
                .setURL(definition.permalink)
                .setDescription(this.truncateText(definition.definition, URBAN_DESCRIPTION_MAX_LENGTH))
                .addFields(
                    { name: 'Example', value: this.truncateText(definition.example, URBAN_EXAMPLE_MAX_LENGTH) },
                    { name: '👍', value: definition.thumbs_up.toString(), inline: true },
                    { name: '👎', value: definition.thumbs_down.toString(), inline: true }
                )
                .setFooter({ text: `Written by ${definition.author}` });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await this.handleError(interaction, error);
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