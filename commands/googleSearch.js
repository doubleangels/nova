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
const { logError } = require('../errors');

const SEARCH_API_URL = 'https://www.googleapis.com/customsearch/v1';
const SEARCH_API_KEY = config.googleApiKey;
const SEARCH_CSE_ID = config.searchEngineId;
const SEARCH_SAFE_SEARCH = 'off';

const SEARCH_DEFAULT_RESULTS = 5;
const SEARCH_MAX_RESULTS = 10;
const SEARCH_MIN_RESULTS = 1;
const SEARCH_COLLECTOR_TIMEOUT = 120000;
const SEARCH_REQUEST_TIMEOUT = 10000;

const SEARCH_EMBED_COLOR = 0x4285F4;
const SEARCH_EMBED_FOOTER = "Powered by Google Search";
const SEARCH_EMBED_PREV_LABEL = "Previous";
const SEARCH_EMBED_NEXT_LABEL = "Next";
const SEARCH_EMBED_PREV_EMOJI = "◀️";
const SEARCH_EMBED_NEXT_EMOJI = "▶️";

const SEARCH_ERROR_CONFIG_MISSING = "⚠️ This command is not properly configured. Please contact an administrator.";
const SEARCH_ERROR_INVALID_QUERY = "⚠️ Please provide a valid search query.";
const SEARCH_ERROR_NO_RESULTS = "⚠️ No results found for your search query.";
const SEARCH_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while searching.";
const SEARCH_ERROR_API = "⚠️ Failed to fetch search results. Please try again later.";
const SEARCH_ERROR_RATE_LIMIT = "⚠️ API rate limit reached. Please try again in a few moments.";
const SEARCH_ERROR_NETWORK = "⚠️ Network error occurred. Please check your internet connection.";

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
        .setDescription(`How many results do you want? (${SEARCH_MIN_RESULTS}-${SEARCH_MAX_RESULTS}, Default: ${SEARCH_DEFAULT_RESULTS})`)
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
      if (!SEARCH_API_KEY || !SEARCH_CSE_ID) {
        logger.error("Missing Google API configuration:", {
          hasApiKey: !!SEARCH_API_KEY,
          hasCseId: !!SEARCH_CSE_ID
        });
        return await interaction.editReply({
          content: SEARCH_ERROR_CONFIG_MISSING,
          ephemeral: true
        });
      }
      
      logger.debug("Processing search query:", { query: interaction.options.getString('query') });
      
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, SEARCH_DEFAULT_RESULTS, SEARCH_MIN_RESULTS, SEARCH_MAX_RESULTS
      );

      if (!searchParams.valid) {
        logger.warn("Invalid search parameters:", { reason: searchParams.error });
        return await interaction.editReply({
          content: SEARCH_ERROR_INVALID_QUERY,
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
          content: SEARCH_ERROR_NO_RESULTS,
          ephemeral: true
        });
      }
      
      await createPaginatedResults(
        interaction,
        searchResults.items,
        index => this.generateResultEmbed(searchResults.items, index),
        'search',
        SEARCH_COLLECTOR_TIMEOUT,
        logger,
        {
          buttonStyle: ButtonStyle.Primary,
          prevLabel: SEARCH_EMBED_PREV_LABEL,
          nextLabel: SEARCH_EMBED_NEXT_LABEL,
          prevEmoji: SEARCH_EMBED_PREV_EMOJI,
          nextEmoji: SEARCH_EMBED_NEXT_EMOJI
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
    
    let errorMessage = SEARCH_ERROR_UNEXPECTED;
    
    if (error.message === "API_ERROR") {
      errorMessage = SEARCH_ERROR_API;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = SEARCH_ERROR_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = SEARCH_ERROR_NETWORK;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for google command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
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
      key: SEARCH_API_KEY,
      cx: SEARCH_CSE_ID,
      q: query,
      num: resultsCount.toString(),
      start: "1",
      safe: SEARCH_SAFE_SEARCH
    });
    const requestUrl = `${SEARCH_API_URL}?${params.toString()}`;
    logger.debug("Preparing Google API request:", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    try {
      const response = await axios.get(requestUrl, { timeout: SEARCH_REQUEST_TIMEOUT });
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
      .setColor(SEARCH_EMBED_COLOR)
      .setFooter({ text: `Result ${index + 1} of ${items.length} • ${SEARCH_EMBED_FOOTER}` });
  }
};