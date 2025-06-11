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

const IMAGES_API_URL = "https://www.googleapis.com/customsearch/v1";
const IMAGES_API_KEY = config.googleApiKey;
const IMAGES_CSE_ID = config.imageSearchEngineId;
const IMAGES_SAFE_SEARCH = "medium";

const IMAGES_DEFAULT_RESULTS = 5;
const IMAGES_MAX_RESULTS = 10;
const IMAGES_MIN_RESULTS = 1;
const IMAGES_COLLECTOR_TIMEOUT = 120000;
const IMAGES_REQUEST_TIMEOUT = 10000;

const IMAGES_EMBED_COLOR = 0x4285F4;
const IMAGES_EMBED_FOOTER = "Powered by Google Image Search";
const IMAGES_EMBED_PREV_LABEL = "Previous";
const IMAGES_EMBED_NEXT_LABEL = "Next";
const IMAGES_EMBED_PREV_EMOJI = "◀️";
const IMAGES_EMBED_NEXT_EMOJI = "▶️";

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
        .setDescription(`How many results do you want? (${IMAGES_MIN_RESULTS}-${IMAGES_MAX_RESULTS}, Default: ${IMAGES_DEFAULT_RESULTS})`)
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
      if (!IMAGES_API_KEY || !IMAGES_CSE_ID) {
        logger.error("Missing Google API configuration:", {
          hasApiKey: !!IMAGES_API_KEY,
          hasCseId: !!IMAGES_CSE_ID
        });
        return await interaction.editReply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          ephemeral: true
        });
      }
      
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, IMAGES_DEFAULT_RESULTS, IMAGES_MIN_RESULTS, IMAGES_MAX_RESULTS
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
      
      await createPaginatedResults(
        interaction,
        searchResults.items,
        index => this.generateImageEmbed(searchResults.items, index),
        'img',
        IMAGES_COLLECTOR_TIMEOUT,
        logger,
        {
          buttonStyle: ButtonStyle.Primary,
          prevLabel: IMAGES_EMBED_PREV_LABEL,
          nextLabel: IMAGES_EMBED_NEXT_LABEL,
          prevEmoji: IMAGES_EMBED_PREV_EMOJI,
          nextEmoji: IMAGES_EMBED_NEXT_EMOJI
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
    url.searchParams.append('key', IMAGES_API_KEY);
    url.searchParams.append('cx', IMAGES_CSE_ID);
    url.searchParams.append('q', query);
    url.searchParams.append('searchType', 'image');
    url.searchParams.append('num', IMAGES_MAX_RESULTS);
    
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
      key: IMAGES_API_KEY,
      cx: IMAGES_CSE_ID,
      q: query,
      searchType: "image",
      num: resultsCount.toString(),
      start: "1",
      safe: IMAGES_SAFE_SEARCH
    });
    const requestUrl = `${IMAGES_API_URL}?${params.toString()}`;
    logger.debug("Preparing Google Image API request:", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    try {
      const response = await axios.get(requestUrl, { timeout: IMAGES_REQUEST_TIMEOUT });
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
      .setColor(IMAGES_EMBED_COLOR)
      .setImage(imageLink)
      .setFooter({ text: `Result ${index + 1} of ${items.length} • ${IMAGES_EMBED_FOOTER}` });
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