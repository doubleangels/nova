/**
 * Urban Dictionary command module for searching and displaying word definitions.
 * Handles API interactions with Urban Dictionary, result formatting, and error management.
 * Uses embeds for better presentation of definitions and examples.
 * @module commands/urban
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger')('urban.js');
const { logError } = require('../errors');

const URBAN_API_URL = 'https://api.urbandictionary.com/v0/define';
const URBAN_REQUEST_TIMEOUT = 10000;

const URBAN_EMBED_COLOR = 0x202C34;
const URBAN_EMBED_FOOTER = 'Powered by Urban Dictionary';

const URBAN_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while searching Urban Dictionary.";
const URBAN_ERROR_API = "⚠️ Failed to retrieve definition from Urban Dictionary. Please try again later.";
const URBAN_ERROR_ACCESS_DENIED = "⚠️ Urban Dictionary API access denied. Please check API configuration.";
const URBAN_ERROR_NO_RESULTS = "⚠️ No definitions found for that term.";
const URBAN_ERROR_INVALID_QUERY = "⚠️ Please provide a valid search term.";
const URBAN_ERROR_REQUEST_TIMEOUT = "⚠️ The request timed out. Please try again.";
const URBAN_ERROR_RATE_LIMIT_EXCEEDED = "⚠️ Too many requests. Please try again later.";

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

            const response = await axios.get(`${URBAN_API_URL}?term=${encodeURIComponent(term)}`, {
                timeout: URBAN_REQUEST_TIMEOUT
            });
            const definitions = response.data.list;

            if (!definitions || definitions.length === 0) {
                await interaction.editReply({
                    content: URBAN_ERROR_NO_RESULTS,
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
                .setFooter({ text: URBAN_EMBED_FOOTER });
            
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
            }).catch(() => {
            });
        }
    }
};