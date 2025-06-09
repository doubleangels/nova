/**
 * Wikipedia command module for searching and displaying Wikipedia articles.
 * Handles API interactions, result formatting, and pagination.
 * @module commands/wikipedia
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const he = require('he');
const { logError } = require('../errors');

const WIKI_API_BASE_URL = 'https://en.wikipedia.org/w/api.php';
const WIKI_API_TIMEOUT = 5000;
const WIKI_CACHE_TTL = 1000 * 60 * 60;

const WIKI_MAX_RESULTS = 5;
const WIKI_SEARCH_MATCH_OPEN_REGEX = /<span class="searchmatch">/g;
const WIKI_SEARCH_MATCH_CLOSE_REGEX = /<\/span>/g;
const WIKI_HTML_TAG_REGEX = /<[^>]*>/g;

const WIKI_EMBED_COLOR = 0xFFFFFF;
const WIKI_FOOTER_TEXT = 'Powered by Wikipedia API';
const WIKI_ARTICLE_URL = 'https://en.wikipedia.org/?curid=%s';

const WIKI_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while searching Wikipedia.";
const WIKI_ERROR_API = "⚠️ Failed to retrieve article from Wikipedia. Please try again later.";
const WIKI_ERROR_RATE_LIMIT = "⚠️ Wikipedia API rate limit reached. Please try again in a few moments.";
const WIKI_ERROR_NETWORK = "⚠️ Network error occurred. Please check your internet connection.";
const WIKI_ERROR_ACCESS_DENIED = "⚠️ Wikipedia API access denied. Please check API configuration.";
const WIKI_ERROR_NO_RESULTS = "⚠️ No articles found matching your search.";
const WIKI_ERROR_INVALID_QUERY = "⚠️ Please provide a valid search term.";
const WIKI_ERROR_REQUEST_TIMEOUT = "⚠️ The request timed out. Please try again.";
const WIKI_ERROR_RATE_LIMIT_EXCEEDED = "⚠️ Too many requests. Please try again later.";
const WIKI_ERROR_ARTICLE_NOT_FOUND = "⚠️ The requested article could not be found.";
const WIKI_ERROR_INVALID_ARTICLE = "⚠️ Invalid article specified.";
const WIKI_ERROR_SEARCH_FAILED = "⚠️ Failed to search Wikipedia articles.";

const cache = new Map();

/**
 * We handle the wikipedia command.
 * This function fetches and displays Wikipedia article summaries.
 *
 * We perform several tasks:
 * 1. Search for the article on Wikipedia
 * 2. Fetch the article summary
 * 3. Create an embed with the article details
 * 4. Send the embed to the user
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('wikipedia')
    .setDescription('Fetch and display Wikipedia article summaries.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('What do you want to search for?')
        .setRequired(true)),

  /**
   * Executes the Wikipedia command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If article search or retrieval fails
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      const query = interaction.options.getString('query');
      
      logger.info("Wikipedia command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id,
        query
      });

      const searchResponse = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          format: 'json',
          origin: '*'
        }
      });

      const searchResults = searchResponse.data.query.search;
      
      if (!searchResults || searchResults.length === 0) {
        await interaction.editReply({
          content: WIKI_ERROR_NO_RESULTS,
          ephemeral: true
        });
        return;
      }

      const article = searchResults[0];
      const summaryResponse = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          prop: 'extracts',
          exintro: true,
          exsentences: 1,
          explaintext: true,
          titles: article.title,
          format: 'json',
          origin: '*'
        }
      });

      const pages = summaryResponse.data.query.pages;
      const pageId = Object.keys(pages)[0];
      let summary = pages[pageId].extract;

      if (summary.length > 1024) {
        summary = summary.substring(0, 1021) + '...';
      }

      const embed = new EmbedBuilder()
        .setColor('#FFFFFF')
        .setTitle(article.title)
        .setDescription(summary)
        .setURL(`https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`)
        .setFooter({ text: 'Powered by Wikipedia' });
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Wikipedia command completed successfully:", {
        userId: interaction.user.id,
        query,
        articleTitle: article.title
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Fetches search results from the Wikipedia API.
   * @async
   * @function fetchWikipediaResults
   * @param {string} query - The search query
   * @returns {Promise<Array>} Array of search results
   */
  async fetchWikipediaResults(query) {
    try {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        list: 'search',
        srsearch: query,
        srlimit: WIKI_MAX_RESULTS,
        utf8: '1',
        prop: 'info|extracts',
        inprop: 'url',
        explaintext: '1'
      });
      
      const requestUrl = `${WIKI_API_BASE_URL}?${params.toString()}`;
      
      logger.debug("Making Wikipedia API request:", { 
        requestUrl
      });
      
      const response = await axios.get(requestUrl, { timeout: WIKI_API_TIMEOUT });
      
      logger.debug("Wikipedia API response received:", { 
        status: response.status
      });
      
      if (response.status === 200 && response.data.query && response.data.query.search) {
        const results = response.data.query.search;
        
        return results.map(result => ({
          ...result,
          url: WIKI_ARTICLE_URL.replace('%s', result.pageid),
          formattedSnippet: this.formatSnippet(result.snippet)
        }));
      }
      
      return [];
    } catch (error) {
      logger.error("Error fetching Wikipedia results:", { 
        error: error.message,
        query
      });
      throw new Error("API_ERROR");
    }
  },
  
  /**
   * Formats a snippet by replacing HTML tags and decoding entities.
   * @function formatSnippet
   * @param {string} snippet - The raw snippet from the API
   * @returns {string} Formatted snippet
   */
  formatSnippet(snippet) {
    if (!snippet) return "No snippet available.";
    
    let formatted = snippet
      .replace(WIKI_SEARCH_MATCH_OPEN_REGEX, '**')
      .replace(WIKI_SEARCH_MATCH_CLOSE_REGEX, '**');
    
    formatted = formatted.replace(WIKI_HTML_TAG_REGEX, '');
    
    formatted = he.decode(formatted);
    
    return formatted;
  },
  
  /**
   * Sends search results as an embed with pagination buttons.
   * @async
   * @function sendSearchResults
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {string} query - The search query
   * @param {Array} results - Array of search results
   * @param {number} index - Index of the current result to display
   */
  async sendSearchResults(interaction, query, results, index) {
    const result = results[index];
    
    const embed = this.createResultEmbed(result, query, index, results.length);
    
    const components = [];
    if (results.length > 1) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`wiki_prev_${index}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),
        new ButtonBuilder()
          .setCustomId(`wiki_next_${index}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === results.length - 1)
      );
      components.push(row);
    }
    
    const message = await interaction.editReply({ 
      embeds: [embed],
      components: components
    });
    
    logger.info("Wikipedia search results sent successfully:", { 
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      query,
      resultIndex: index,
      totalResults: results.length
    });
    
    if (results.length > 1) {
      this.setupPaginationCollector(message, interaction, query, results, index);
    }
  },
  
  /**
   * Creates an embed for a Wikipedia search result.
   * @function createResultEmbed
   * @param {Object} result - The search result
   * @param {string} query - The search query
   * @param {number} index - Index of the current result
   * @param {number} total - Total number of results
   * @returns {EmbedBuilder} Discord embed with the result
   */
  createResultEmbed(result, query, index, total) {
    const title = result.title || "No Title";
    const snippet = result.formattedSnippet;
    const url = result.url;
    const wordCount = result.wordcount || 0;
    const lastModified = result.timestamp ? 
      new Date(result.timestamp).toLocaleDateString() : 
      "Unknown";
    
    const embed = new EmbedBuilder()
      .setTitle(`📖 ${title}`)
      .setDescription(`📜 **Summary:** ${snippet}`)
      .setURL(url)
      .setColor(WIKIPEDIA_EMBED_COLOR)
      .addFields(
        { 
          name: '🔗 Wikipedia Link', 
          value: `[Click Here](${url})`, 
          inline: true 
        },
        {
          name: '📊 Article Info',
          value: `📝 Word Count: ${wordCount.toLocaleString()}\n📅 Last Updated: ${lastModified}`,
          inline: true
        }
      )
      .setFooter({ 
        text: `${WIKIPEDIA_FOOTER_TEXT} • Result ${index + 1} of ${total} for "${query}"`
      });
    
    return embed;
  },
  
  /**
   * Sets up a collector for pagination button interactions.
   * @function setupPaginationCollector
   * @param {import('discord.js').Message} message - The message with the pagination buttons
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The original interaction
   * @param {string} query - The search query
   * @param {Array} results - Array of search results
   * @param {number} currentIndex - Current result index
   */
  setupPaginationCollector(message, interaction, query, results, currentIndex) {
    const filter = i => 
      i.user.id === interaction.user.id && 
      (i.customId.startsWith(`wiki_prev_`) || 
       i.customId.startsWith(`wiki_next_`));
    
    const collector = message.createMessageComponentCollector({ 
      filter, 
      time: 300000
    });
    
    collector.on('collect', async i => {
      let newIndex = currentIndex;
      
      if (i.customId.startsWith(`wiki_next_`)) {
        newIndex = Math.min(results.length - 1, currentIndex + 1);
      } else if (i.customId.startsWith(`wiki_prev_`)) {
        newIndex = Math.max(0, currentIndex - 1);
      }
      
      await i.deferUpdate();
      await this.sendSearchResults(interaction, query, results, newIndex);
      
      collector.stop();
    });
    
    collector.on('end', collected => {
      if (collected.size === 0) {
        const embed = this.createResultEmbed(
          results[currentIndex], 
          query, 
          currentIndex, 
          results.length
        );
        
        interaction.editReply({ 
          embeds: [embed],
          components: [] 
        }).catch(err => {
          logger.error("Failed to remove buttons after timeout", {
            error: err.message
          });
        });
      }
    });
  },
  
  /**
   * Gets cached search results for a query.
   * @function getCachedResults
   * @param {string} cacheKey - The cache key
   * @returns {Array|null} Cached results or null if not found
   */
  getCachedResults(cacheKey) {
    const cached = cache.get(cacheKey);
    
    if (cached && cached.expiry > Date.now()) {
      return cached.results;
    }
    
    if (cached) {
      cache.delete(cacheKey);
    }
    
    return null;
  },
  
  /**
   * Caches search results for a query.
   * @function cacheResults
   * @param {string} cacheKey - The cache key
   * @param {Array} results - The search results to cache
   */
  cacheResults(cacheKey, results) {
    cache.set(cacheKey, {
      results,
      expiry: Date.now() + WIKIPEDIA_CACHE_TTL
    });
    
    logger.debug("Cached Wikipedia results:", { 
      cacheKey,
      resultCount: results.length,
      expiryMinutes: WIKIPEDIA_CACHE_TTL / 60000
    });
  },
  
  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'wikipedia', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = ERROR_MESSAGES.API_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.API_NETWORK_ERROR;
    } else if (error.message === "NO_RESULTS") {
      errorMessage = ERROR_MESSAGES.NO_RESULTS_FOUND;
    } else if (error.message === "INVALID_QUERY") {
      errorMessage = ERROR_MESSAGES.INVALID_QUERY;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = ERROR_MESSAGES.REQUEST_TIMEOUT;
    } else if (error.response?.status === 403) {
      errorMessage = ERROR_MESSAGES.API_ACCESS_DENIED;
    } else if (error.response?.status === 429) {
      errorMessage = ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;
    } else if (error.response?.status >= 500) {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for wikipedia command:", {
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
  }
};