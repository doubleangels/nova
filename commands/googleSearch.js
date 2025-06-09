/**
 * Google Search command module for searching and displaying web results.
 * Handles API interactions with Google Custom Search and result formatting.
 * @module commands/googleSearch
 */

const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams, formatApiError } = require('../utils/searchUtils');
const { logError, ERROR_MESSAGES } = require('../errors');

const API_URL = 'https://www.googleapis.com/customsearch/v1';
const DEFAULT_RESULTS = 5;
const MIN_RESULTS = 1;
const MAX_RESULTS = 10;
const COLLECTOR_TIMEOUT = 120000;
const EMBED_COLOR = 0x4285F4;
const REQUEST_TIMEOUT = 10000;
const SAFE_SEARCH = 'off';

const GOOGLE_API_KEY = config.googleApiKey;
const GOOGLE_CSE_ID = config.searchEngineId;

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
   * Executes the Google web search command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the API request fails
   */
  async execute(interaction) {
    await interaction.deferReply();
    logger.info("/google command initiated:", { 
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
      
      logger.debug("Processing search query:", { query: interaction.options.getString('query') });
      
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, DEFAULT_RESULTS, MIN_RESULTS, MAX_RESULTS
      );

      if (!searchParams.valid) {
        logger.warn("Invalid search parameters:", { reason: searchParams.error });
        return await interaction.editReply({
          content: ERROR_MESSAGES.INVALID_QUERY,
          ephemeral: true
        });
      }

      logger.debug("Formatted search parameters:", { 
        query: searchParams.query, 
        count: searchParams.count 
      });

      const searchResults = await this.fetchSearchResults(searchParams.query, searchParams.count);
      
      if (searchResults.error) {
        return await interaction.editReply({
          content: searchResults.message,
          ephemeral: true
        });
      }

      if (searchResults.items.length === 0) {
        logger.warn("No search results found for query:", { query: searchParams.query });
        return await interaction.editReply({ 
          content: ERROR_MESSAGES.NO_RESULTS_FOUND,
          ephemeral: true
        });
      }
      
      await createPaginatedResults(
        interaction,
        searchResults.items,
        index => this.generateResultEmbed(searchResults.items, index),
        'search',
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
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'google', {
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
    }
    
    try {
      await interaction.editReply({ 
        content: getErrorMessage(error),
        ephemeral: true
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for google command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: getErrorMessage(error),
        ephemeral: true
      }).catch(() => {
      });
    }
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
    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      cx: GOOGLE_CSE_ID,
      q: query,
      num: resultsCount.toString(),
      start: "1",
      safe: SAFE_SEARCH
    });
    const requestUrl = `${API_URL}?${params.toString()}`;
    logger.debug("Preparing Google API request:", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    try {
      const response = await axios.get(requestUrl, { timeout: REQUEST_TIMEOUT });
      logger.debug("Google API response received:", { 
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