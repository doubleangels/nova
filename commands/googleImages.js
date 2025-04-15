const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams, formatApiError } = require('../utils/searchUtils');

// Configuration constants
const SEARCH_API_URL = "https://www.googleapis.com/customsearch/v1";
const DEFAULT_RESULTS_COUNT = 5;
const MAX_RESULTS = 10;
const MIN_RESULTS = 1;
const COLLECTOR_TIMEOUT = 120000; // 2 minute timeout
const EMBED_COLOR = 0x4285F4; // Google blue color
const SAFE_SEARCH = "medium"; // Can be "off", "medium", or "high"

/**
 * Converts a string to title case.
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
   * Executes the /googleimages command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Validate API configuration
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          ephemeral: true
        });
      }

      // Defer reply to allow processing time
      await interaction.deferReply();
      logger.info(`/googleimages command initiated.`, { 
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      // Get and validate search parameters
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, DEFAULT_RESULTS_COUNT, MIN_RESULTS, MAX_RESULTS
      );
          
      if (!searchParams.valid) {
        logger.warn("Invalid search parameters.", { reason: searchParams.error });
        return await interaction.editReply({
          content: "⚠️ Please provide a valid search query."
        });
      }
      
      // Format the query to title case
      searchParams.query = titleCase(searchParams.query);
      
      logger.debug("Formatted search parameters.", { 
        query: searchParams.query, 
        count: searchParams.count 
      });

      // Fetch image search results
      const searchResults = await this.fetchImageResults(searchParams.query, searchParams.count);
      
      if (searchResults.error) {
        return await interaction.editReply({
          content: searchResults.message
        });
      }
      
      if (searchResults.items.length === 0) {
        logger.warn("No image results found for query.", { query: searchParams.query });
        return await interaction.editReply({
          content: `⚠️ No images found for **${searchParams.query}**. Try refining your search query.`
        });
      }
      
      // Create paginated results with Google-themed buttons
      await createPaginatedResults(
        interaction,
        searchResults.items,
        index => this.generateImageEmbed(searchResults.items, index),
        'img',
        COLLECTOR_TIMEOUT,
        logger,
        {
          buttonStyle: ButtonStyle.Primary, // Google blue
          prevLabel: 'Previous',
          nextLabel: 'Next',
          prevEmoji: '◀️',
          nextEmoji: '▶️'
        }
      );
    } catch (error) {
      logger.error("Error executing /googleimages command.", { 
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later."
      });
    }
  },
  
  /**
   * Validates that the required configuration is available.
   * @returns {boolean} True if configuration is valid, false otherwise.
   */
  validateConfiguration() {
    if (!config.googleApiKey || !config.imageSearchEngineId) {
      logger.error("Google API configuration is missing.", {
        hasApiKey: !!config.googleApiKey,
        hasSearchEngineId: !!config.imageSearchEngineId
      });
      return false;
    }
    return true;
  },
  
  /**
   * Fetches image search results from the Google API.
   * @param {string} query - The search query.
   * @param {number} resultsCount - The number of results to fetch.
   * @returns {Object} The search results or error information.
   */
  async fetchImageResults(query, resultsCount) {
    // Construct the Google Custom Search API URL and parameters
    const params = new URLSearchParams({
      key: config.googleApiKey,
      cx: config.imageSearchEngineId,
      q: query,
      searchType: "image",
      num: resultsCount.toString(),
      start: "1",
      safe: SAFE_SEARCH
    });
    const requestUrl = `${SEARCH_API_URL}?${params.toString()}`;
    logger.debug("Preparing Google Image API request.", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    // Make the API request using axios
    try {
      const response = await axios.get(requestUrl);
      logger.debug("Google Image API response received.", { 
        status: response.status,
        itemsReturned: response.data?.items?.length || 0
      });
      
      return {
        items: response.data.items || []
      };
    } catch (apiError) {
      logger.error("Google API request failed.", { 
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
   * Generates an embed for an image search result.
   * @param {Array} items - The search result items.
   * @param {number} index - The index of the current item.
   * @returns {EmbedBuilder} The generated embed.
   */
  generateImageEmbed(items, index) {
    const item = items[index];
    const title = item.title || "No Title";
    // Ensure we have a valid image link
    const imageLink = item.link || "";
    // Use contextLink if available, otherwise fallback to the image link
    const pageLink = item.image?.contextLink || imageLink;
    
    return new EmbedBuilder()
      .setTitle(`🖼️ ${title}`)
      .setDescription(`🔗 **[View Original Source](${pageLink})**`)
      .setColor(EMBED_COLOR)
      .setImage(imageLink)
      .setFooter({ text: `Result ${index + 1} of ${items.length} • Powered by Google Image Search` });
  }
};