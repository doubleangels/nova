/**
 * We handle the urban command.
 * This function fetches and displays definitions from Urban Dictionary.
 *
 * We perform several tasks:
 * 1. We fetch the definition from Urban Dictionary API.
 * 2. We create an embed with the definition details.
 * 3. We send the embed to the user.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger')('urban.js');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We use these configuration constants for the Urban Dictionary API.
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
                .setDescription('The term to look up')
                .setRequired(true)),

    async execute(interaction) {
        try {
            // We defer the reply since the API call might take a moment.
            await interaction.deferReply();
            
            // We get the search term from the interaction options.
            const term = interaction.options.getString('term');
            
            logger.info("Urban Dictionary command initiated:", {
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
                    content: ERROR_MESSAGES.NO_RESULTS_FOUND,
                    ephemeral: true
                });
                return;
            }

            // We get the first definition and create an embed.
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
            
            // We send the embed to the user.
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
     * We truncate text to a maximum length and add ellipsis if needed.
     * This function ensures text fits within embed limits.
     *
     * @param {string} text - The text to truncate.
     * @param {number} maxLength - The maximum length allowed.
     * @returns {string} The truncated text.
     */
    truncateText(text, maxLength) {
        if (!text) return 'No example provided.';
        return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
    },

    /**
     * We handle errors that occur during command execution.
     * This function logs the error and attempts to notify the user.
     *
     * @param {CommandInteraction} interaction - The interaction that triggered the command.
     * @param {Error} error - The error that occurred.
     */
    async handleError(interaction, error) {
        logError(error, 'urban', {
            userId: interaction.user?.id,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        try {
            await interaction.editReply({ 
                content: getErrorMessage(error),
                ephemeral: true 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for urban command:", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: getErrorMessage(error),
                ephemeral: true 
            }).catch(() => {
                // We silently catch if all error handling attempts fail.
            });
        }
    }
};