const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams, formatApiError } = require('../utils/searchUtils');

const titleCase = str =>
  str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Command module for searching and displaying Google Images results.
 * Provides paginated results with image previews and source links.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('googleimages')
    .setDescription('Search Google for images and return the top results.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What images do you want to search for?')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('results')
        .setDescription('How many results do you want? (1-10, Default: 5)')
        .setRequired(false)
    ),

  /**
   * Executes the Google Images search command.
   * This function:
   * 1. Validates API configuration and search parameters
   * 2. Fetches image results from Google API
   * 3. Creates paginated embeds with image previews
   * 4. Handles error cases and rate limits
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error during the search process
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply();
    logger.info("/googleimages command initiated:", { 
      userId: interaction.user.id, 
      guildId: interaction.guildId 
    });
    
    try {
      if (!config.googleApiKey || !config.imageSearchEngineId) {
        logger.error("Missing Google API configuration:", {
          hasApiKey: !!config.googleApiKey,
          hasCseId: !!config.imageSearchEngineId
        });
        return await interaction.editReply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          ephemeral: true
        });
      }
      
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, 5, 1, 10
      );
          
      if (!searchParams.valid) {
        logger.warn("Invalid search parameters:", { reason: searchParams.error });
        return await interaction.editReply({
          content: "⚠️ Please provide a valid search query.",
          ephemeral: true
        });
      }
      
      searchParams.query = titleCase(searchParams.query);
      
      logger.debug("Formatted search parameters:", { 
        query: searchParams.query, 
        count: searchParams.count 
      });

      const searchResults = await this.fetchImageResults(searchParams.query, searchParams.count);
      
      if (searchResults.error) {
        return await interaction.editReply({
          content: searchResults.message,
          ephemeral: true
        });
      }
      
      if (searchResults.items.length === 0) {
        logger.warn("No image results found for query:", { query: searchParams.query });
        return await interaction.editReply({
          content: "⚠️ No images found for your search query.",
          ephemeral: true
        });
      }

      const generateEmbed = (index) => this.generateImageEmbed(searchResults.items, index);

      await createPaginatedResults(
        interaction,
        searchResults.items,
        generateEmbed,
        'googleimages',
        120000,
        logger,
        {
          buttonStyle: ButtonStyle.Secondary,
          nextLabel: 'Next',
          prevEmoji: '⬅️',
          nextEmoji: '➡️'
        }
      );

      logger.info("/googleimages command completed successfully:", {
        userId: interaction.user.id,
        query: searchParams.query,
        resultCount: searchResults.items.length
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Searches for images using the Google Custom Search API.
   * 
   * @param {string} query - The search query
   * @returns {Promise<Array>} Array of image search results
   * @throws {Error} If the API request fails
   */
  async searchImages(query) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.append('key', config.googleApiKey);
    url.searchParams.append('cx', config.imageSearchEngineId);
    url.searchParams.append('q', query);
    url.searchParams.append('searchType', 'image');
    url.searchParams.append('num', '10');
    
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Google API request failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.items || [];
  },
  
  /**
   * Fetches image results from the Google API with error handling.
   * 
   * @param {string} query - The search query
   * @param {number} resultsCount - Number of results to fetch
   * @returns {Promise<Object>} Object containing search results or error information
   */
  async fetchImageResults(query, resultsCount) {
    const params = new URLSearchParams({
      key: config.googleApiKey,
      cx: config.imageSearchEngineId,
      q: query,
      searchType: "image",
      num: resultsCount.toString(),
      start: "1",
      safe: "medium"
    });
    const requestUrl = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    logger.debug("Preparing Google Image API request:", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    try {
      const response = await axios.get(requestUrl, { timeout: 10000 });
      logger.debug("Google Image API response received:", { 
        status: response.status,
        itemsReturned: response.data?.items?.length || 0
      });
      
      return {
        items: response.data.items || []
      };
    } catch (apiError) {
      logger.error("Google API request failed:", { 
        error: apiError.message,
        status: apiError.response?.status,
        errorDetails: apiError.response?.data
      });

      return {
        error: true,
        message: formatApiError(apiError)
      };
    }
  },
  
  /**
   * Generates an embed for displaying an image search result.
   * 
   * @param {Array} items - Array of search result items
   * @param {number} index - Index of the current result to display
   * @returns {EmbedBuilder} Discord embed with image preview and metadata
   */
  generateImageEmbed(items, index) {
    const item = items[index];
    const title = item.title || "No Title";
    const imageLink = item.link || "";
    const pageLink = item.image?.contextLink || imageLink;
    
    return new EmbedBuilder()
      .setTitle(`🖼️ ${title}`)
      .setDescription(`🔗 **[View Original Source](${pageLink})**`)
      .setColor(0x4285F4)
      .setImage(imageLink)
      .setFooter({ text: `Powered by Google Image Search • Result ${index + 1} of ${items.length}` });
  },

  /**
   * Handles errors that occur during command execution.
   * Logs the error and sends an appropriate error message to the user.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in googleimages command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while searching for images.";
    
    if (error.message.includes('API')) {
      errorMessage = "⚠️ Failed to fetch search results. Please try again later.";
    } else if (error.message.includes('network')) {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    } else if (error.message.includes('rate limit')) {
      errorMessage = "⚠️ API rate limit reached. Please try again in a few moments.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for googleimages command:", {
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