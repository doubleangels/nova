const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// Configuration constants.
const URBAN_EMBED_COLOR = 0x1D2439;
const URBAN_DICTIONARY_API_URL = 'https://api.urbandictionary.com/v0/define';

/**
 * Sanitizes text from the Urban Dictionary API for safe rendering.
 * 
 * @param {string} text - The text to sanitize.
 * @returns {string} - Sanitized text.
 */
function sanitizeText(text) {
  if (!text) return '';
  
  // Replace newlines and carriage returns for proper formatting
  return text.replace(/\r\n/g, '\n')
    // Truncate if extremely long (Discord has 4096 char limit for embed descriptions)
    .substring(0, 1000) 
    // Add ellipsis if truncated
    + (text.length > 1000 ? '...' : '');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('urban')
    .setDescription('Search Urban Dictionary for definitions.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What term do you want to search for?')
        .setRequired(true)
    ),
    
  /**
   * Executes the Urban Dictionary search command and returns the definition.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Get the query term from the interaction options.
      const query = interaction.options.getString('query');
      
      logger.info("Urban Dictionary search initiated.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        query: query,
        channelId: interaction.channelId,
        guildId: interaction.guildId
      });
      
      // Defer the reply to allow time for the API call.
      await interaction.deferReply();
      
      // Construct the Urban Dictionary API URL with query parameters.
      const params = new URLSearchParams({ term: query });
      const requestUrl = `${URBAN_DICTIONARY_API_URL}?${params.toString()}`;
      
      logger.debug("Fetching data from Urban Dictionary API.", {
        query: query,
        requestUrl: requestUrl
      });
      
      // Fetch the definition data using axios.
      const response = await axios.get(requestUrl, { 
        timeout: 5000 // Add timeout for safety
      });
      
      // Process successful API response.
      if (response.status === 200) {
        const data = response.data;
        
        // Check if any definitions were returned.
        if (data.list && data.list.length > 0) {
          const topResult = data.list[0];
          const word = topResult.word || 'No Word';
          const definition = sanitizeText(topResult.definition || 'No Definition Available.');
          const example = sanitizeText(topResult.example || 'No example available.');
          const thumbsUp = topResult.thumbs_up || 0;
          const thumbsDown = topResult.thumbs_down || 0;
          
          logger.debug("Definition found for query.", {
            query: query,
            word: word,
            definitionLength: definition.length,
            thumbsUp: thumbsUp,
            thumbsDown: thumbsDown
          });
          
          // Build an embed with the retrieved definition.
          const embed = new EmbedBuilder()
            .setTitle(`📖 Definition: ${word}`)
            .setDescription(definition)
            .setColor(URBAN_EMBED_COLOR)
            .addFields(
              { name: '📝 Example', value: example, inline: false },
              { name: '👍 Thumbs Up', value: `${thumbsUp}`, inline: true },
              { name: '👎 Thumbs Down', value: `${thumbsDown}`, inline: true }
            )
            .setFooter({ text: '🔍 Powered by Urban Dictionary' });
          
          // Edit the deferred reply with the embed.
          await interaction.editReply({ embeds: [embed] });
          
          logger.info("Urban Dictionary definition sent successfully.", {
            userId: interaction.user.id,
            query: query,
            word: word
          });
        } else {
          // No definitions found.
          logger.info("No Urban Dictionary definitions found for query.", {
            userId: interaction.user.id,
            query: query
          });
          
          await interaction.editReply({ 
            content: '⚠️ No definitions found for your query. Try refining it.', 
            ephemeral: true 
          });
        }
      } else {
        // Log if the API response was not successful.
        logger.warn("Urban Dictionary API returned non-200 status code.", {
          userId: interaction.user.id,
          query: query,
          status: response.status,
          statusText: response.statusText
        });
        
        await interaction.editReply({ 
          content: `⚠️ Error: Urban Dictionary API returned status code ${response.status}.`, 
          ephemeral: true 
        });
      }
    } catch (error) {
      // Handle network errors or other exceptions.
      logger.error("Error executing Urban Dictionary command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        query: interaction.options.getString('query')
      });
      
      // Determine if interaction has already been deferred.
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.', 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.', 
          ephemeral: true 
        });
      }
    }
  }
};
