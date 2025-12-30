const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const logger = require('../logger')('urban.js');

/**
 * Command module for searching Urban Dictionary definitions.
 * Fetches and displays word definitions with examples and ratings.
 * @type {Object}
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('urban')
        .setDescription('Fetch and display definitions from Urban Dictionary.')
        .addStringOption(option =>
            option.setName('term')
                .setDescription('What do you want to search for?')
                .setRequired(true)),

    /**
     * Executes the urban dictionary search command.
     * This function:
     * 1. Fetches definition from Urban Dictionary API
     * 2. Formats and displays the result
     * 3. Handles any errors that occur
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @throws {Error} If there's an error searching Urban Dictionary
     * @returns {Promise<void>}
     */
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
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const definition = definitions[0];
            const embed = new EmbedBuilder()
                .setColor(0x202C34)
                .setTitle(`📚 Urban Dictionary: ${definition.word}`)
                .setDescription(definition.definition)
                .addFields(
                    { name: 'Example', value: definition.example || 'No example provided.' },
                    { name: 'Author', value: definition.author },
                    { name: '👍', value: definition.thumbs_up.toString(), inline: true },
                    { name: '👎', value: definition.thumbs_down.toString(), inline: true }
                );
            
            await interaction.editReply({ embeds: [embed] });
            
            logger.info("/urban command completed successfully:", {
                userId: interaction.user.id,
                term
            });
        } catch (error) {
            await this.handleError(interaction, error);
        }
    },

    /**
     * Handles errors that occur during command execution.
     * 
     * @param {CommandInteraction} interaction - The interaction that triggered the command
     * @param {Error} error - The error that occurred
     * @returns {Promise<void>}
     */
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
                flags: MessageFlags.Ephemeral 
            });
        } catch (followUpError) {
            logger.error("Failed to send error response for urban command:", {
                error: followUpError.message,
                originalError: error.message,
                userId: interaction.user?.id
            });
            
            await interaction.reply({ 
                content: errorMessage,
                flags: MessageFlags.Ephemeral 
            }).catch(() => {});
        }
    }
};