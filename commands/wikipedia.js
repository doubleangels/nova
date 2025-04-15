const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const he = require('he'); // HTML entity decoder

// Configuration constants.
const WIKIPEDIA_API_TIMEOUT = 5000;
const WIKIPEDIA_EMBED_COLOR = 0xFFFFFF;
const WIKIPEDIA_SEARCH_MATCH_OPEN_REGEX = /<span class="searchmatch">/g;
const WIKIPEDIA_SEARCH_MATCH_CLOSE_REGEX = /<\/span>/g;
const WIKIPEDIA_HTML_TAG_REGEX = /<[^>]*>/g;
const WIKIPEDIA_MAX_RESULTS = 5; // Maximum number of results to fetch
const WIKIPEDIA_CACHE_TTL = 1000 * 60 * 60; // 1 hour cache TTL

// Language-specific constants
const WIKIPEDIA_LANGUAGE_CONFIG = {
  en: {
    apiBaseUrl: 'https://en.wikipedia.org/w/api.php',
    articleUrl: 'https://en.wikipedia.org/?curid=%s',
    footerText: 'Powered by Wikipedia API'
  },
  es: {
    apiBaseUrl: 'https://es.wikipedia.org/w/api.php',
    articleUrl: 'https://es.wikipedia.org/?curid=%s',
    footerText: 'Proporcionado por la API de Wikipedia'
  },
  fr: {
    apiBaseUrl: 'https://fr.wikipedia.org/w/api.php',
    articleUrl: 'https://fr.wikipedia.org/?curid=%s',
    footerText: 'Alimenté par l\'API Wikipedia'
  },
  de: {
    apiBaseUrl: 'https://de.wikipedia.org/w/api.php',
    articleUrl: 'https://de.wikipedia.org/?curid=%s',
    footerText: 'Unterstützt von der Wikipedia-API'
  },
  ja: {
    apiBaseUrl: 'https://ja.wikipedia.org/w/api.php',
    articleUrl: 'https://ja.wikipedia.org/?curid=%s',
    footerText: 'Wikipedia APIを利用'
  }
};

// Simple in-memory cache
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
    )
    .addStringOption(option =>
      option
        .setName('language')
        .setDescription('Which Wikipedia language to search (default: English)')
        .setRequired(false)
        .addChoices(
          { name: 'English', value: 'en' },
          { name: 'Spanish', value: 'es' },
          { name: 'French', value: 'fr' },
          { name: 'German', value: 'de' },
          { name: 'Japanese', value: 'ja' }
        )
    ),
    
  /**
   * Executes the /wikipedia command.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for the API call.
      await interaction.deferReply();
      
      const query = interaction.options.getString('query');
      const language = interaction.options.getString('language') || 'en';
      
      logger.debug("Wikipedia command received.", { 
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        query,
        language
      });
      
      // Trim the query to remove unnecessary whitespace.
      const formattedQuery = query.trim();
      
      // Check if we have cached results for this query and language
      const cacheKey = `${language}:${formattedQuery.toLowerCase()}`;
      const cachedResults = this.getCachedResults(cacheKey);
      
      if (cachedResults) {
        logger.debug("Using cached Wikipedia results.", { 
          query: formattedQuery,
          language,
          resultCount: cachedResults.length
        });
        
        await this.sendSearchResults(interaction, formattedQuery, cachedResults, language, 0);
        return;
      }
      
      logger.debug("Processing Wikipedia search query.", { 
        formattedQuery,
        language
      });
      
      // Get language-specific configuration
      const langConfig = WIKIPEDIA_LANGUAGE_CONFIG[language] || WIKIPEDIA_LANGUAGE_CONFIG.en;
      
      // Fetch search results from Wikipedia API
      const searchResults = await this.fetchWikipediaResults(formattedQuery, language, langConfig);
      
      if (!searchResults || searchResults.length === 0) {
        logger.warn("No Wikipedia results found for query.", { 
          query: formattedQuery,
          language,
          userId: interaction.user.id
        });
        
        await interaction.editReply({ 
          content: `⚠️ No results found for **${formattedQuery}** in ${this.getLanguageName(language)} Wikipedia. Try refining your search!`
        });
        return;
      }
      
      // Cache the results
      this.cacheResults(cacheKey, searchResults);
      
      // Send the first result with pagination if there are multiple results
      await this.sendSearchResults(interaction, formattedQuery, searchResults, language, 0);
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Fetches search results from the Wikipedia API.
   * 
   * @param {string} query - The search query.
   * @param {string} language - The Wikipedia language code.
   * @param {Object} langConfig - Language-specific configuration.
   * @returns {Promise<Array>} Array of search results.
   */
  async fetchWikipediaResults(query, language, langConfig) {
    try {
      // Build the Wikipedia API URL with query parameters.
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
      
      const requestUrl = `${langConfig.apiBaseUrl}?${params.toString()}`;
      
      logger.debug("Making Wikipedia API request.", { 
        requestUrl,
        language
      });
      
      // Make the API request using axios with a timeout.
      const response = await axios.get(requestUrl, { timeout: WIKIPEDIA_API_TIMEOUT });
      
      logger.debug("Wikipedia API response received.", { 
        status: response.status,
        language
      });
      
      if (response.status === 200 && response.data.query && response.data.query.search) {
        // Get detailed information for each result
        const results = response.data.query.search;
        
        // Enhance results with additional information
        return results.map(result => ({
          ...result,
          url: langConfig.articleUrl.replace('%s', result.pageid),
          formattedSnippet: this.formatSnippet(result.snippet)
        }));
      }
      
      return [];
    } catch (error) {
      logger.error("Error fetching Wikipedia results.", { 
        error: error.message,
        query,
        language
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
    
    // Replace search match spans with bold markdown
    let formatted = snippet
      .replace(WIKIPEDIA_SEARCH_MATCH_OPEN_REGEX, '**')
      .replace(WIKIPEDIA_SEARCH_MATCH_CLOSE_REGEX, '**');
    
    // Remove other HTML tags
    formatted = formatted.replace(WIKIPEDIA_HTML_TAG_REGEX, '');
    
    // Decode HTML entities
    formatted = he.decode(formatted);
    
    return formatted;
  },
  
  /**
   * Sends search results as an embed with pagination buttons.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {string} query - The search query.
   * @param {Array} results - Array of search results.
   * @param {string} language - The Wikipedia language code.
   * @param {number} index - Index of the current result to display.
   * @returns {Promise<void>}
   */
  async sendSearchResults(interaction, query, results, language, index) {
    const result = results[index];
    const langConfig = WIKIPEDIA_LANGUAGE_CONFIG[language] || WIKIPEDIA_LANGUAGE_CONFIG.en;
    
    // Create the embed
    const embed = this.createResultEmbed(result, query, language, langConfig, index, results.length);
    
    // Create pagination buttons if there are multiple results
    const components = [];
    if (results.length > 1) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`wiki_prev_${language}_${index}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),
        new ButtonBuilder()
          .setCustomId(`wiki_next_${language}_${index}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === results.length - 1)
      );
      components.push(row);
    }
    
    // Send or edit the reply
    const message = await interaction.editReply({ 
      embeds: [embed],
      components: components
    });
    
    logger.info("Wikipedia search results sent successfully.", { 
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      query,
      language,
      resultIndex: index,
      totalResults: results.length
    });
    
    // Set up button collector for pagination
    if (results.length > 1) {
      this.setupPaginationCollector(message, interaction, query, results, language, index);
    }
  },
  
  /**
   * Creates an embed for a Wikipedia search result.
   * 
   * @param {Object} result - The search result.
   * @param {string} query - The search query.
   * @param {string} language - The Wikipedia language code.
   * @param {Object} langConfig - Language-specific configuration.
   * @param {number} index - Index of the current result.
   * @param {number} total - Total number of results.
   * @returns {EmbedBuilder} - Discord embed with the result.
   */
  createResultEmbed(result, query, language, langConfig, index, total) {
    const title = result.title || "No Title";
    const snippet = result.formattedSnippet;
    const url = result.url;
    const wordCount = result.wordcount || 0;
    const lastModified = result.timestamp ? 
      new Date(result.timestamp).toLocaleDateString() : 
      "Unknown";
    
    // Create the embed
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
        text: `${langConfig.footerText} • Result ${index + 1} of ${total} for "${query}"`
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
   * @param {string} language - The Wikipedia language code.
   * @param {number} currentIndex - Current result index.
   * @returns {void}
   */
  setupPaginationCollector(message, interaction, query, results, language, currentIndex) {
    // Create a collector for button interactions
    const filter = i => 
      i.user.id === interaction.user.id && 
      (i.customId.startsWith(`wiki_prev_${language}_`) || 
       i.customId.startsWith(`wiki_next_${language}_`));
    
    const collector = message.createMessageComponentCollector({ 
      filter, 
      time: 300000 // 5 minutes
    });
    
    collector.on('collect', async i => {
      // Calculate the new index based on which button was clicked
      let newIndex = currentIndex;
      
      if (i.customId.startsWith(`wiki_next_${language}_`)) {
        newIndex = Math.min(results.length - 1, currentIndex + 1);
      } else if (i.customId.startsWith(`wiki_prev_${language}_`)) {
        newIndex = Math.max(0, currentIndex - 1);
      }
      
      // Update the message with the new result
      await i.deferUpdate();
      await this.sendSearchResults(interaction, query, results, language, newIndex);
      
      // Stop the old collector
      collector.stop();
    });
    
    collector.on('end', collected => {
      // If the collector ends due to timeout, remove the buttons
      if (collected.size === 0) {
        const langConfig = WIKIPEDIA_LANGUAGE_CONFIG[language] || WIKIPEDIA_LANGUAGE_CONFIG.en;
        const embed = this.createResultEmbed(
          results[currentIndex], 
          query, 
          language, 
          langConfig, 
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
    
    // Remove expired entry if it exists
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
   * Gets the display name for a language code.
   * 
   * @param {string} code - The language code.
   * @returns {string} - The language display name.
   */
  getLanguageName(code) {
    const languages = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      ja: 'Japanese'
    };
    
    return languages[code] || code;
  },
  
  /**
   * Handles errors that occur during command execution.
   * 
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logger.error("Error executing Wikipedia command.", { 
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      query: interaction.options?.getString('query') 
    });
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.'
        });
      } else {
        await interaction.reply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.'
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