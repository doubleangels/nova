const { SlashCommandBuilder, EmbedBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams, formatApiError } = require('../utils/searchUtils');

/**
 * Command module for performing Google web searches.
 * Provides paginated results with summaries and links.
 * @type {Object}
 */
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
        .setDescription('How many results do you want? (1-10, Default: 5)')
        .setRequired(false)
    ),

  /**
   * Executes the Google search command.
   * This function:
   * 1. Validates API configuration and search parameters
   * 2. Fetches search results from Google API
   * 3. Creates paginated embeds with result summaries
   * 4. Handles error cases and rate limits
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error during the search process
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply();
    logger.info("/google command initiated:", { 
      userId: interaction.user.id, 
      guildId: interaction.guildId 
    });
    
    try {
      if (!config.googleApiKey || !config.searchEngineId) {
        logger.error("Missing Google API configuration:", {
          hasApiKey: !!config.googleApiKey,
          hasCseId: !!config.searchEngineId
        });
        return await interaction.editReply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          flags: MessageFlags.Ephemeral
        });
      }
      
      logger.debug("Processing search query:", { query: interaction.options.getString('query') });
      
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, 5, 1, 10
      );

      if (!searchParams.valid) {
        logger.warn("Invalid search parameters:", { reason: searchParams.error });
        return await interaction.editReply({
          content: "⚠️ Please provide a valid search query.",
          flags: MessageFlags.Ephemeral
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
          flags: MessageFlags.Ephemeral
        });
      }

      if (searchResults.items.length === 0) {
        logger.warn("No search results found for query:", { query: searchParams.query });
        return await interaction.editReply({ 
          content: "⚠️ No results found for your search query.",
          flags: MessageFlags.Ephemeral
        });
      }
      
      await createPaginatedResults(
        interaction,
        searchResults.items,
        index => this.generateResultEmbed(searchResults.items, index),
        'search',
        120000,
        logger,
        {
          buttonStyle: ButtonStyle.Primary,
          prevLabel: "Previous",
          nextLabel: "Next",
          prevEmoji: "◀️",
          nextEmoji: "▶️"
        }
      );

      logger.info("/google command completed successfully:", {
        userId: interaction.user.id,
        query: searchParams.query,
        resultCount: searchResults.items.length
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
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
    logger.error("Error in google command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while searching.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to fetch search results. Please try again later.";
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = "⚠️ API rate limit reached. Please try again in a few moments.";
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for google command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  },
  
  /**
   * Fetches search results from the Google API with error handling.
   * 
   * @param {string} query - The search query
   * @param {number} resultsCount - Number of results to fetch
   * @returns {Promise<Object>} Object containing search results or error information
   */
  async fetchSearchResults(query, resultsCount) {
    const params = new URLSearchParams({
      key: config.googleApiKey,
      cx: config.searchEngineId,
      q: query,
      num: resultsCount.toString(),
      start: "1",
      safe: "off"
    });
    const requestUrl = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    logger.debug("Preparing Google API request:", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    try {
      const response = await axios.get(requestUrl, { timeout: 10000 });
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
   * Generates an embed for displaying a search result.
   * 
   * @param {Array} items - Array of search result items
   * @param {number} index - Index of the current result to display
   * @returns {EmbedBuilder} Discord embed with result summary and metadata
   */
  generateResultEmbed(items, index) {
    const item = items[index];
    const title = item.title || "No Title Found";
    const link = item.link || "No Link Found";
    const snippet = item.snippet || "No Description Found";
    
    return new EmbedBuilder()
      .setTitle(`🔍 ${title}`)
      .setDescription(`📜 **Summary:** ${snippet}\n🔗 [Read More](${link})`)
      .setColor(0x4285F4)
      .setFooter({ text: `Powered by Google Search • Result ${index + 1} of ${items.length}` });
  }
};