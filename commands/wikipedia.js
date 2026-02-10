const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const he = require('he');


/**
 * Command module for searching and displaying Wikipedia article summaries.
 * Supports article search and summary extraction with caching.
 * @type {Object}
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
   * Executes the Wikipedia search command.
   * This function:
   * 1. Searches for articles matching the query
   * 2. Fetches summary of the first result
   * 3. Creates and sends an embed with the article information
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error searching Wikipedia
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      const query = interaction.options.getString('query');
      
      logger.info("/wikipedia command initiated.", {
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
        },
        headers: {
          'User-Agent': 'Nova Discord Bot (https://github.com/doubleangels/nova)'
        }
      });

      const searchResults = searchResponse.data.query.search;
      
      if (!searchResults || searchResults.length === 0) {
        await interaction.editReply({
          content: "⚠️ No results found for your search query.",
          flags: MessageFlags.Ephemeral
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
        },
        headers: {
          'User-Agent': 'Nova Discord Bot (https://github.com/doubleangels/nova)'
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
      
      logger.info("/wikipedia command completed successfully.", {
        userId: interaction.user.id,
        query,
        articleTitle: article.title
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  async handleError(interaction, error) {
    logger.error("Error occurred in wikipedia command.", {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while searching Wikipedia. Please try again later.";
    
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
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for wikipedia command.", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  }
};