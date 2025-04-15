const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams, formatApiError } = require('../utils/searchUtils');

// These are the configuration constants for the Google Images search.
const SEARCH_API_URL = "https://www.googleapis.com/customsearch/v1";
const DEFAULT_RESULTS_COUNT = 5;
const MAX_RESULTS = 10;
const MIN_RESULTS = 1;
const COLLECTOR_TIMEOUT = 120000; // 2 minute timeout for pagination controls
const EMBED_COLOR = 0x4285F4; // Google blue color for consistent branding
const SAFE_SEARCH = "medium"; // Can be "off", "medium", or "high" for content filtering

/**
 * Converts a string to title case for better presentation.
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
      // We validate that the API configuration is properly set up before proceeding.
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          ephemeral: true
        });
      }

      // We defer the reply to allow time for the API request and processing.
      await interaction.deferReply();
      logger.info(`/googleimages command initiated.`, { 
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      // We get and validate the search parameters provided by the user.
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, DEFAULT_RESULTS_COUNT, MIN_RESULTS, MAX_RESULTS
      );
          
      if (!searchParams.valid) {
        logger.warn("Invalid search parameters.", { reason: searchParams.error });
        return await interaction.editReply({
          content: "⚠️ Please provide a valid search query.",
          ephemeral: true
        });
      }
      
      // We format the query to title case for better presentation.
      searchParams.query = titleCase(searchParams.query);
      
      logger.debug("Formatted search parameters.", { 
        query: searchParams.query, 
        count: searchParams.count 
      });

      // We fetch image search results from the Google API.
      const searchResults = await this.fetchImageResults(searchParams.query, searchParams.count);
      
      if (searchResults.error) {
        return await interaction.editReply({
          content: searchResults.message,
          ephemeral: true
        });
      }
      
      if (searchResults.items.length === 0) {
        logger.warn("No image results found for query.", { query: searchParams.query });
        return await interaction.editReply({
          content: `⚠️ No images found for **${searchParams.query}**. Try refining your search query.`,
          ephemeral: true
        });
      }
      
      // We create paginated results with Google-themed buttons for navigation.
      await createPaginatedResults(
        interaction,
        searchResults.items,
        index => this.generateImageEmbed(searchResults.items, index),
        'img',
        COLLECTOR_TIMEOUT,
        logger,
        {
          buttonStyle: ButtonStyle.Primary, // Google blue for consistent branding
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
        content: "⚠️ An unexpected error occurred. Please try again later.",
        ephemeral: true
      });
    }
  },
  
  /**
   * Validates that the required API configuration is available.
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
   * Fetches image search results from the Google Custom Search API.
   * @param {string} query - The search query.
   * @param {number} resultsCount - The number of results to fetch.
   * @returns {Object} The search results or error information.
   */
  async fetchImageResults(query, resultsCount) {
    // We construct the Google Custom Search API URL with all necessary parameters.
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

    // We make the API request using axios and handle the response.
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
   * Generates an embed for an image search result with proper formatting.
   * @param {Array} items - The search result items.
   * @param {number} index - The index of the current item.
   * @returns {EmbedBuilder} The generated embed with image and metadata.
   */
  generateImageEmbed(items, index) {
    const item = items[index];
    const title = item.title || "No Title";
    // We ensure we have a valid image link for the embed.
    const imageLink = item.link || "";
    // We use contextLink if available, otherwise fallback to the image link.
    const pageLink = item.image?.contextLink || imageLink;
    
    return new EmbedBuilder()
      .setTitle(`🖼️ ${title}`)
      .setDescription(`🔗 **[View Original Source](${pageLink})**`)
      .setColor(EMBED_COLOR)
      .setImage(imageLink)
      .setFooter({ text: `Result ${index + 1} of ${items.length} • Powered by Google Image Search` });
  }
};