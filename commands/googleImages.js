/**
 * Google Images command module for searching and displaying images.
 * Handles API interactions with Google Custom Search and image result formatting.
 * @module commands/googleImages
 */

const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams, formatApiError } = require('../utils/searchUtils');
const { logError } = require('../errors');

const SEARCH_API_URL = "https://www.googleapis.com/customsearch/v1";
const DEFAULT_RESULTS_COUNT = 5;
const MAX_RESULTS = 10;
const MIN_RESULTS = 1;
const COLLECTOR_TIMEOUT = 120000;
const EMBED_COLOR = 0x4285F4;
const SAFE_SEARCH = "medium";

const GOOGLE_API_KEY = config.googleApiKey;
const GOOGLE_CSE_ID = config.imageSearchEngineId;

/**
 * Error messages specific to the Google Images command.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    CONFIG_MISSING: "⚠️ This command is not properly configured. Please contact an administrator.",
    INVALID_QUERY: "⚠️ Please provide a valid search query.",
    NO_RESULTS_FOUND: "⚠️ No images found for your search query.",
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while searching for images.",
    API_ERROR: "⚠️ Failed to fetch search results. Please try again later.",
    API_RATE_LIMIT: "⚠️ API rate limit reached. Please try again in a few moments.",
    API_NETWORK_ERROR: "⚠️ Network error occurred. Please check your internet connection.",
    GOOGLE_API_ERROR: "⚠️ Failed to fetch search results from Google. Please try again later.",
    GOOGLE_NO_RESULTS: "⚠️ No images found for your search query."
};

/**
 * We convert a string to title case for better presentation.
 * This function capitalizes the first letter of each word.
 *
 * @param {string} str - The input string.
 * @returns {string} The title-cased string.
 */
const titleCase = str =>
  str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

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
        .setDescription(`How many results do you want? (${MIN_RESULTS}-${MAX_RESULTS}, Default: ${DEFAULT_RESULTS_COUNT})`)
        .setRequired(false)
    ),

  /**
   * Executes the Google Images search command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the API request fails
   */
  async execute(interaction) {
    await interaction.deferReply();
    logger.info("/googleimages command initiated:", { 
      userId: interaction.user.id, 
      guildId: interaction.guildId 
    });
    
    try {
      if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
        logger.error("Missing Google API configuration:", {
          hasApiKey: !!GOOGLE_API_KEY,
          hasCseId: !!GOOGLE_CSE_ID
        });
        return await interaction.editReply({
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
      }
      
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, DEFAULT_RESULTS_COUNT, MIN_RESULTS, MAX_RESULTS
      );
          
      if (!searchParams.valid) {
        logger.warn("Invalid search parameters:", { reason: searchParams.error });
        return await interaction.editReply({
          content: ERROR_MESSAGES.INVALID_QUERY,
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
          content: ERROR_MESSAGES.NO_RESULTS_FOUND,
          ephemeral: true
        });
      }
      
      await createPaginatedResults(
        interaction,
        searchResults.items,
        index => this.generateImageEmbed(searchResults.items, index),
        'img',
        COLLECTOR_TIMEOUT,
        logger,
        {
          buttonStyle: ButtonStyle.Primary,
          prevLabel: 'Previous',
          nextLabel: 'Next',
          prevEmoji: '◀️',
          nextEmoji: '▶️'
        }
      );
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Searches for images using Google Custom Search API.
   * @async
   * @function searchImages
   * @param {string} query - The search query
   * @returns {Promise<Array<Object>>} Array of image search results
   * @throws {Error} If the API request fails
   */
  async searchImages(query) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.append('key', GOOGLE_API_KEY);
    url.searchParams.append('cx', GOOGLE_CSE_ID);
    url.searchParams.append('q', query);
    url.searchParams.append('searchType', 'image');
    url.searchParams.append('num', MAX_RESULTS);
    
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Google API request failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.items || [];
  },
  
  /**
   * We fetch image search results from the Google Custom Search API.
   * This function retrieves and processes the image search results.
   *
   * @param {string} query - The search query.
   * @param {number} resultsCount - The number of results to fetch.
   * @returns {Object} The search results or error information.
   */
  async fetchImageResults(query, resultsCount) {
    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      cx: GOOGLE_CSE_ID,
      q: query,
      searchType: "image",
      num: resultsCount.toString(),
      start: "1",
      safe: SAFE_SEARCH
    });
    const requestUrl = `${SEARCH_API_URL}?${params.toString()}`;
    logger.debug("Preparing Google Image API request:", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    try {
      const response = await axios.get(requestUrl);
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
   * We generate an embed for an image search result with proper formatting.
   * This function creates a visually appealing embed for each image result.
   *
   * @param {Array} items - The search result items.
   * @param {number} index - The index of the current item.
   * @returns {EmbedBuilder} The generated embed with image and metadata.
   */
  generateImageEmbed(items, index) {
    const item = items[index];
    const title = item.title || "No Title";
    const imageLink = item.link || "";
    const pageLink = item.image?.contextLink || imageLink;
    
    return new EmbedBuilder()
      .setTitle(`🖼️ ${title}`)
      .setDescription(`🔗 **[View Original Source](${pageLink})**`)
      .setColor(EMBED_COLOR)
      .setImage(imageLink)
      .setFooter({ text: `Result ${index + 1} of ${items.length} • Powered by Google Image Search` });
  },

  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'googleimages', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.GOOGLE_API_ERROR;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = ERROR_MESSAGES.API_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.API_NETWORK_ERROR;
    } else if (error.message === "NO_RESULTS") {
      errorMessage = ERROR_MESSAGES.GOOGLE_NO_RESULTS;
    } else if (error.message === "INVALID_QUERY") {
      errorMessage = ERROR_MESSAGES.INVALID_QUERY;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        flags: [4096]
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for googleimages command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: [4096]
      }).catch(() => {
      });
    }
  }
};