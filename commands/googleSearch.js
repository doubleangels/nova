const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams, formatApiError } = require('../utils/searchUtils');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We define configuration constants for the Google search command.
const API_URL = 'https://www.googleapis.com/customsearch/v1';
const DEFAULT_RESULTS = 5;
const MIN_RESULTS = 1;
const MAX_RESULTS = 10;
const COLLECTOR_TIMEOUT = 120000; // 2 minute timeout for pagination controls
const EMBED_COLOR = 0x4285F4; // Google blue color for consistent branding
const REQUEST_TIMEOUT = 10000; // 10 second API request timeout to prevent hanging
const SAFE_SEARCH = 'off'; // Options: 'off', 'medium', 'high' for content filtering

module.exports = {
  data: new SlashCommandBuilder()
    .setName('google')
    .setDescription('Search Google and return the top results.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What do you want to search for?')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('results')
        .setDescription(`How many results do you want? (${MIN_RESULTS}-${MAX_RESULTS}, Default: ${DEFAULT_RESULTS})`)
        .setRequired(false)
    ),

  /**
   * We handle the google command.
   * This function allows users to search the web using Google's Custom Search API.
   *
   * We perform several tasks:
   * 1. We validate Google API configuration.
   * 2. We process web search requests.
   * 3. We format and display search results.
   * 4. We handle pagination and user interaction.
   *
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // We validate that the API configuration is properly set up before proceeding.
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
      }

      // We defer the reply to allow time for the API request and processing.
      await interaction.deferReply();
      logger.info(`/google command initiated.`, { 
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      // We get and validate the search parameters provided by the user.
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, DEFAULT_RESULTS, MIN_RESULTS, MAX_RESULTS
      );

      if (!searchParams.valid) {
        logger.warn("Invalid search parameters.", { reason: searchParams.error });
        return await interaction.editReply({
          content: ERROR_MESSAGES.INVALID_QUERY,
          ephemeral: true
        });
      }

      logger.debug("Formatted search parameters.", { 
        query: searchParams.query, 
        count: searchParams.count 
      });

      // We fetch search results from the Google API.
      const searchResults = await this.fetchSearchResults(searchParams.query, searchParams.count);
      
      if (searchResults.error) {
        return await interaction.editReply({
          content: searchResults.message,
          ephemeral: true
        });
      }

      if (searchResults.items.length === 0) {
        logger.warn("No search results found for query.", { query: searchParams.query });
        return await interaction.editReply({ 
          content: ERROR_MESSAGES.NO_RESULTS_FOUND,
          ephemeral: true
        });
      }
      
      // We create paginated results with Google-themed buttons for navigation.
      await createPaginatedResults(
        interaction,
        searchResults.items,
        index => this.generateResultEmbed(searchResults.items, index),
        'search',
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
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'googleSearch', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.GOOGLE_API_ERROR;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = ERROR_MESSAGES.API_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.API_NETWORK_ERROR;
    }
    
    try {
      await interaction.editReply({ 
        content: getErrorMessage(error),
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for google command.", {
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
  },
  
  /**
   * We validate that the required API configuration is available.
   * This function checks for the presence of necessary API keys and IDs.
   *
   * @returns {boolean} True if configuration is valid, false otherwise.
   */
  validateConfiguration() {
    if (!config.googleApiKey || !config.searchEngineId) {
      logger.error("Google API configuration is missing.", {
        hasApiKey: !!config.googleApiKey,
        hasSearchEngineId: !!config.searchEngineId
      });
      return false;
    }
    return true;
  },
  
  /**
   * We fetch search results from the Google Custom Search API.
   * This function retrieves and processes the web search results.
   *
   * @param {string} query - The search query.
   * @param {number} resultsCount - The number of results to fetch.
   * @returns {Object} The search results or error information.
   */
  async fetchSearchResults(query, resultsCount) {
    // We build the Google Custom Search API request with all necessary parameters.
    const params = new URLSearchParams({
      key: config.googleApiKey,
      cx: config.searchEngineId,
      q: query,
      num: resultsCount.toString(),
      start: "1",
      safe: SAFE_SEARCH
    });
    const requestUrl = `${API_URL}?${params.toString()}`;
    logger.debug("Preparing Google API request.", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    // We fetch data from the API using axios with a timeout to prevent hanging.
    try {
      const response = await axios.get(requestUrl, { timeout: REQUEST_TIMEOUT });
      logger.debug("Google API response received.", { 
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
   * We generate an embed for a search result with proper formatting.
   * This function creates a visually appealing embed for each search result.
   *
   * @param {Array} items - The search result items.
   * @param {number} index - The index of the current item.
   * @returns {EmbedBuilder} The generated embed with search result information.
   */
  generateResultEmbed(items, index) {
    const item = items[index];
    const title = item.title || "No Title Found";
    const link = item.link || "No Link Found";
    const snippet = item.snippet || "No Description Found";
    
    return new EmbedBuilder()
      .setTitle(`🔍 ${title}`)
      .setDescription(`📜 **Summary:** ${snippet}\n🔗 [Read More](${link})`)
      .setColor(EMBED_COLOR)
      .setFooter({ text: `Result ${index + 1} of ${items.length} • Powered by Google Search` });
  }
};