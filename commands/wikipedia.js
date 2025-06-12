const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const he = require('he');

const cache = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wikipedia')
    .setDescription('Fetch and display Wikipedia article summaries.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('What do you want to search for?')
        .setRequired(true)),

  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      const query = interaction.options.getString('query');
      
      logger.info("/wikipedia command initiated:", {
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
          content: "⚠️ No results found for your search query.",
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
        .setColor(0xFFFFFF)
        .setTitle(article.title)
        .setDescription(summary)
        .setURL(`https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`)
        .setFooter({ text: 'Powered by Wikipedia' });
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/wikipedia command completed successfully:", {
        userId: interaction.user.id,
        query,
        articleTitle: article.title
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  formatSnippet(snippet) {
    if (!snippet) return "No snippet available.";
    
    let formatted = snippet
      .replace(/<span class="searchmatch">/g, '**')
      .replace(/<\/span>/g, '**');
    
    formatted = formatted.replace(/<[^>]*>/g, '');
    
    formatted = he.decode(formatted);
    
    return formatted;
  },

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

  cacheResults(cacheKey, results) {
    cache.set(cacheKey, {
      results,
      expiry: Date.now() + (1000 * 60 * 60)
    });
    
    logger.debug("Cached Wikipedia results:", { 
      cacheKey,
      resultCount: results.length,
      expiryMinutes: 60
    });
  },
  
  async handleError(interaction, error) {
    logger.error("Error in wikipedia command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while searching Wikipedia.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to search Wikipedia. Please try again later.";
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = "⚠️ Rate limit exceeded. Please try again in a few minutes.";
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    } else if (error.message === "NO_RESULTS") {
      errorMessage = "⚠️ No results found for your search query.";
    } else if (error.message === "INVALID_QUERY") {
      errorMessage = "⚠️ Please provide a valid search query.";
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = "⚠️ Request timed out. Please try again later.";
    } else if (error.response?.status === 403) {
      errorMessage = "⚠️ Access to Wikipedia API denied. Please try again later.";
    } else if (error.response?.status === 429) {
      errorMessage = "⚠️ Too many requests. Please try again in a few minutes.";
    } else if (error.response?.status >= 500) {
      errorMessage = "⚠️ Wikipedia API is currently unavailable. Please try again later.";
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
      }).catch(() => {});
    }
  }
};