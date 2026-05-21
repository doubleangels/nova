const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const httpClient = require('../utils/httpClient');
const { getCached, setCached, cacheKey } = require('../utils/responseCache');


/**
 * Command module for searching and displaying Wikipedia article summaries.
 * Supports article search and summary extraction with caching.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('wikipedia')
    .setDescription('Fetch and display Wikipedia article summaries.')
    .setDefaultMemberPermissions(null)
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

      const normalizedQuery = query.trim().toLowerCase();
      const cacheId = cacheKey('wikipedia', normalizedQuery);
      const cached = getCached(cacheId);
      if (cached) {
        await interaction.editReply({ embeds: [cached] });
        return;
      }

      const summaryResponse = await httpClient.get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(query), {
        timeout: 10000,
        headers: {
          'User-Agent': 'Nova Discord Bot (https://github.com/doubleangels/nova)'
        }
      });

      const page = summaryResponse.data;
      if (!page?.extract) {
        await interaction.editReply({
          content: "⚠️ No results found for your search query.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      let summary = page.extract;
      if (summary.length > 1024) {
        summary = summary.substring(0, 1021) + '...';
      }

      const title = page.title || query;
      const embed = new EmbedBuilder()
        .setColor(0xFFFFFF)
        .setTitle(title)
        .setDescription(summary)
        .setURL(page.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`)
        .setFooter({ text: 'Powered by Wikipedia' });

      setCached(cacheId, embed, 900000);
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/wikipedia command completed successfully.", {
        userId: interaction.user.id,
        query,
        articleTitle: title
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