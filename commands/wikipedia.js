const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const he = require('he'); // This is used for HTML entity decoding.

// These are the configuration constants for the Wikipedia integration.
const WIKIPEDIA_API_TIMEOUT = 5000; // We set a 5-second timeout for API requests.
const WIKIPEDIA_EMBED_COLOR = 0xFFFFFF; // We use white color for Wikipedia embeds.
const WIKIPEDIA_SEARCH_MATCH_OPEN_REGEX = /<span class="searchmatch">/g;
const WIKIPEDIA_SEARCH_MATCH_CLOSE_REGEX = /<\/span>/g;
const WIKIPEDIA_HTML_TAG_REGEX = /<[^>]*>/g;
const WIKIPEDIA_MAX_RESULTS = 5; // We limit to a maximum of 5 results to prevent overload.
const WIKIPEDIA_CACHE_TTL = 1000 * 60 * 60; // We cache results for 1 hour to reduce API calls.
const WIKIPEDIA_API_BASE_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_ARTICLE_URL = 'https://en.wikipedia.org/?curid=%s';
const WIKIPEDIA_FOOTER_TEXT = 'Powered by Wikipedia API';

// We use a simple in-memory cache to store search results.
const cache = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wikipedia')
    .setDescription('Search Wikipedia for articles.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What topic do you want to search for?')
        .setRequired(true)
    ),
    
  /**
   * Executes the /wikipedia command.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // We defer the reply to allow time for the API call.
      await interaction.deferReply();
      
      const query = interaction.options.getString('query');
      
      logger.debug("Wikipedia command received.", { 
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        query
      });
      
      // We trim the query to remove unnecessary whitespace.
      const formattedQuery = query.trim();
      
      // We check if we have cached results for this query.
      const cacheKey = formattedQuery.toLowerCase();
      const cachedResults = this.getCachedResults(cacheKey);
      
      if (cachedResults) {
        logger.debug("Using cached Wikipedia results.", { 
          query: formattedQuery,
          resultCount: cachedResults.length
        });
        
        await this.sendSearchResults(interaction, formattedQuery, cachedResults, 0);
        return;
      }
      
      logger.debug("Processing Wikipedia search query.", { 
        formattedQuery
      });
      
      // We fetch search results from the Wikipedia API.
      const searchResults = await this.fetchWikipediaResults(formattedQuery);
      
      if (!searchResults || searchResults.length === 0) {
        logger.warn("No Wikipedia results found for query.", { 
          query: formattedQuery,
          userId: interaction.user.id
        });
        
        await interaction.editReply({ 
          content: `⚠️ No results found for **${formattedQuery}** in Wikipedia. Try refining your search!`,
          ephemeral: true
        });
        return;
      }
      
      // We cache the results to reduce API calls for repeated searches.
      this.cacheResults(cacheKey, searchResults);
      
      // We send the first result with pagination if there are multiple results.
      await this.sendSearchResults(interaction, formattedQuery, searchResults, 0);
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Fetches search results from the Wikipedia API.
   * 
   * @param {string} query - The search query.
   * @returns {Promise<Array>} Array of search results.
   */
  async fetchWikipediaResults(query) {
    try {
      // We build the Wikipedia API URL with query parameters.
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        list: 'search',
        srsearch: query,
        srlimit: WIKIPEDIA_MAX_RESULTS,
        utf8: '1',
        prop: 'info|extracts',
        inprop: 'url',
        explaintext: '1'
      });
      
      const requestUrl = `${WIKIPEDIA_API_BASE_URL}?${params.toString()}`;
      
      logger.debug("Making Wikipedia API request.", { 
        requestUrl
      });
      
      // We make the API request using axios with a timeout for safety.
      const response = await axios.get(requestUrl, { timeout: WIKIPEDIA_API_TIMEOUT });
      
      logger.debug("Wikipedia API response received.", { 
        status: response.status
      });
      
      if (response.status === 200 && response.data.query && response.data.query.search) {
        // We get the search results from the API response.
        const results = response.data.query.search;
        
        // We enhance results with additional information for display.
        return results.map(result => ({
          ...result,
          url: WIKIPEDIA_ARTICLE_URL.replace('%s', result.pageid),
          formattedSnippet: this.formatSnippet(result.snippet)
        }));
      }
      
      return [];
    } catch (error) {
      logger.error("Error fetching Wikipedia results.", { 
        error: error.message,
        query
      });
      throw error;
    }
  },
  
  /**
   * Formats a snippet by replacing HTML tags and decoding entities.
   * 
   * @param {string} snippet - The raw snippet from the API.
   * @returns {string} - Formatted snippet.
   */
  formatSnippet(snippet) {
    if (!snippet) return "No snippet available.";
    
    // We replace search match spans with bold markdown for better readability.
    let formatted = snippet
      .replace(WIKIPEDIA_SEARCH_MATCH_OPEN_REGEX, '**')
      .replace(WIKIPEDIA_SEARCH_MATCH_CLOSE_REGEX, '**');
    
    // We remove other HTML tags to clean up the text.
    formatted = formatted.replace(WIKIPEDIA_HTML_TAG_REGEX, '');
    
    // We decode HTML entities to display proper characters.
    formatted = he.decode(formatted);
    
    return formatted;
  },
  
  /**
   * Sends search results as an embed with pagination buttons.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {string} query - The search query.
   * @param {Array} results - Array of search results.
   * @param {number} index - Index of the current result to display.
   * @returns {Promise<void>}
   */
  async sendSearchResults(interaction, query, results, index) {
    const result = results[index];
    
    // We create the embed with the current search result.
    const embed = this.createResultEmbed(result, query, index, results.length);
    
    // We create pagination buttons if there are multiple results.
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
    
    // We send or edit the reply with the embed and buttons.
    const message = await interaction.editReply({ 
      embeds: [embed],
      components: components
    });
    
    logger.info("Wikipedia search results sent successfully.", { 
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      query,
      resultIndex: index,
      totalResults: results.length
    });
    
    // We set up button collector for pagination if there are multiple results.
    if (results.length > 1) {
      this.setupPaginationCollector(message, interaction, query, results, index);
    }
  },
  
  /**
   * Creates an embed for a Wikipedia search result.
   * 
   * @param {Object} result - The search result.
   * @param {string} query - The search query.
   * @param {number} index - Index of the current result.
   * @param {number} total - Total number of results.
   * @returns {EmbedBuilder} - Discord embed with the result.
   */
  createResultEmbed(result, query, index, total) {
    const title = result.title || "No Title";
    const snippet = result.formattedSnippet;
    const url = result.url;
    const wordCount = result.wordcount || 0;
    const lastModified = result.timestamp ? 
      new Date(result.timestamp).toLocaleDateString() : 
      "Unknown";
    
    // We create the embed with all the relevant information.
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
   * 
   * @param {Message} message - The message with the pagination buttons.
   * @param {ChatInputCommandInteraction} interaction - The original interaction.
   * @param {string} query - The search query.
   * @param {Array} results - Array of search results.
   * @param {number} currentIndex - Current result index.
   * @returns {void}
   */
  setupPaginationCollector(message, interaction, query, results, currentIndex) {
    // We create a collector to handle button interactions.
    const filter = i => 
      i.user.id === interaction.user.id && 
      (i.customId.startsWith(`wiki_prev_`) || 
       i.customId.startsWith(`wiki_next_`));
    
    const collector = message.createMessageComponentCollector({ 
      filter, 
      time: 300000 // We set a 5-minute timeout for the collector.
    });
    
    collector.on('collect', async i => {
      // We calculate the new index based on which button was clicked.
      let newIndex = currentIndex;
      
      if (i.customId.startsWith(`wiki_next_`)) {
        newIndex = Math.min(results.length - 1, currentIndex + 1);
      } else if (i.customId.startsWith(`wiki_prev_`)) {
        newIndex = Math.max(0, currentIndex - 1);
      }
      
      // We update the message with the new result.
      await i.deferUpdate();
      await this.sendSearchResults(interaction, query, results, newIndex);
      
      // We stop the old collector to prevent overlapping collectors.
      collector.stop();
    });
    
    collector.on('end', collected => {
      // If the collector ends due to timeout, we remove the buttons.
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
   * 
   * @param {string} cacheKey - The cache key.
   * @returns {Array|null} - Cached results or null if not found.
   */
  getCachedResults(cacheKey) {
    const cached = cache.get(cacheKey);
    
    if (cached && cached.expiry > Date.now()) {
      return cached.results;
    }
    
    // We remove expired entries to keep the cache clean.
    if (cached) {
      cache.delete(cacheKey);
    }
    
    return null;
  },
  
  /**
   * Caches search results for a query.
   * 
   * @param {string} cacheKey - The cache key.
   * @param {Array} results - The search results to cache.
   */
  cacheResults(cacheKey, results) {
    cache.set(cacheKey, {
      results,
      expiry: Date.now() + WIKIPEDIA_CACHE_TTL
    });
    
    logger.debug("Cached Wikipedia results.", { 
      cacheKey,
      resultCount: results.length,
      expiryMinutes: WIKIPEDIA_CACHE_TTL / 60000
    });
  },
  
  /**
   * Handles errors that occur during command execution.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    // We log any unexpected errors and send an error message to the user.
    logger.error("Error executing Wikipedia command.", { 
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      query: interaction.options?.getString('query') 
    });
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.',
          ephemeral: true
        });
      } else {
        await interaction.reply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.',
          ephemeral: true
        });
      }
    } catch (replyError) {
      logger.error("Failed to send error response for Wikipedia command.", {
        error: replyError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
    }
  }
};