/**
 * Urban Dictionary command module for searching and displaying word definitions.
 * Handles API interactions with Urban Dictionary, result formatting, and error management.
 * Uses embeds for better presentation of definitions and examples.
 * @module commands/urban
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger')('urban.js');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

const URBAN_API_URL = 'https://api.urbandictionary.com/v0/define';
const URBAN_EMBED_COLOR = 0x202C34;
const URBAN_DESCRIPTION_MAX_LENGTH = 1024;
const URBAN_EXAMPLE_MAX_LENGTH = 1024;
const URBAN_REQUEST_TIMEOUT = 10000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('urban')
        .setDescription('Fetch and display definitions from Urban Dictionary.')
        .addStringOption(option =>
            option.setName('term')
                .setDescription('What do you want to search for?')
                .setRequired(true)),

    /**
     * Executes the Urban Dictionary command.
     * Fetches definitions from Urban Dictionary API and displays them in an embed.
     * @async
     * @function execute
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @throws {Error} If the API request fails or if no definitions are found
     */
    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            const term = interaction.options.getString('term');
            
            logger.info("/urban command initiated:", {
                userId: interaction.user.id,
                guildId: interaction.guildId
            });

            const response = await axios.get(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`);
            const definitions = response.data.list;

            if (!definitions || definitions.length === 0) {
                await interaction.editReply({
                    content: ERROR_MESSAGES.NO_RESULTS_FOUND,
                    ephemeral: true
                });
                return;
            }

            const definition = definitions[0];
            const embed = new EmbedBuilder()
                .setColor(URBAN_EMBED_COLOR)
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
            
            logger.info("Urban Dictionary command completed successfully:", {
                userId: interaction.user.id,
                term
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * Truncates text to a maximum length, adding ellipsis if necessary.
     * Used to ensure text fits within Discord's embed field limits.
     * @function truncateText
     * @param {string} text - The text to truncate
     * @param {number} maxLength - Maximum length of the text
     * @returns {string} The truncated text
     */
    truncateText(text, maxLength) {
        if (!text) return 'No example provided.';
        return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
    },

    /**
     * Handles errors that occur during command execution.
     * Logs the error and sends an appropriate error message to the user.
     * @async
     * @function handleError
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {Error} error - The error that occurred
     */
    async handleError(interaction, error) {
        logError(error, 'urban', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
        
        if (error.message === "NO_DEFINITION") {
            errorMessage = ERROR_MESSAGES.URBAN_NO_DEFINITION;
        } else if (error.message === "INVALID_QUERY") {
            errorMessage = ERROR_MESSAGES.URBAN_INVALID_QUERY;
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
            }).catch(() => {
            });
        }
    }
};