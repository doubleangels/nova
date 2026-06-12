const { SlashCommandBuilder, EmbedBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { serializeError } = require('../utils/logSanitize.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults, normalizeSearchParams, formatApiError } = require('../utils/searchUtils');
const { fetchGoogleImagesContext } = require('../utils/commandContextAi');
const { formatAiContextField } = require('../utils/geminiContextMessages');
const { truncateEmbedTitle } = require('../utils/embedUtils');

const titleCase = str =>
  str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Command module for searching and displaying Google Images results.
 * Provides paginated results with image previews and source links.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('googleimages')
    .setDescription('Search Google for images and return the top results.')
    .setDefaultMemberPermissions(null)
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What images do you want to search for?')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('results')
        .setDescription('How many results do you want? (1-10)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  /**
   * Executes the Google Images search command.
   * This function:
   * 1. Validates API configuration and search parameters
   * 2. Fetches image results from Google API
   * 3. Creates paginated embeds with image previews
   * 4. Handles error cases and rate limits
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error during the search process
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    await interaction.deferReply();
    logger.info("/googleimages command initiated.", { 
      userId: interaction.user.id, 
      guildId: interaction.guildId 
    });
    
    try {
      if (!config.googleApiKey || !config.imageSearchEngineId) {
        logger.error("Missing Google API configuration.", {
          hasApiKey: !!config.googleApiKey,
          hasCseId: !!config.imageSearchEngineId
        });
        return await interaction.editReply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          flags: MessageFlags.Ephemeral
        });
      }
      
      const query = interaction.options.getString('query');
      const resultsCount = interaction.options.getInteger('results');
      const searchParams = normalizeSearchParams(
        query, resultsCount, 5, 1, 10
      );
          
      if (!searchParams.valid) {
        logger.warn("Invalid search parameters provided.", { reason: searchParams.error });
        return await interaction.editReply({
          content: "⚠️ Please provide a valid search query.",
          flags: MessageFlags.Ephemeral
        });
      }
      
      searchParams.query = titleCase(searchParams.query);
      
      logger.debug("Formatted search parameters.", { 
        query: searchParams.query, 
        count: searchParams.count 
      });

      const searchResults = await this.fetchImageResults(searchParams.query, searchParams.count);
      
      if (searchResults.error) {
        return await interaction.editReply({
          content: searchResults.message,
          flags: MessageFlags.Ephemeral
        });
      }
      
      if (searchResults.items.length === 0) {
        logger.warn("No image results found for query.", { query: searchParams.query });
        return await interaction.editReply({
          content: "⚠️ No images found for your search query.",
          flags: MessageFlags.Ephemeral
        });
      }

      const searchQuery = searchParams.query;
      const generateEmbed = (index) =>
        this.generateImageEmbed(searchResults.items, index, searchQuery);

      await createPaginatedResults(
        interaction,
        searchResults.items,
        generateEmbed,
        'googleimages',
        120000,
        logger,
        {
          buttonStyle: ButtonStyle.Secondary,
          nextLabel: 'Next',
          prevEmoji: '⬅️',
          nextEmoji: '➡️'
        }
      );

      logger.info("/googleimages command completed successfully.", {
        userId: interaction.user.id,
        query: searchParams.query,
        resultCount: searchResults.items.length
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Fetches image results from the Google API with error handling.
   * 
   * @param {string} query - The search query
   * @param {number} resultsCount - Number of results to fetch
   * @returns {Promise<Object>} Object containing search results or error information
   */
  async fetchImageResults(query, resultsCount) {
    const params = new URLSearchParams({
      key: config.googleApiKey,
      cx: config.imageSearchEngineId,
      q: query,
      searchType: "image",
      num: resultsCount.toString(),
      start: "1",
      safe: "medium"
    });
    const requestUrl = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    logger.debug("Preparing Google Image API request.", { 
      searchQuery: query,
      resultsRequested: resultsCount
    });

    try {
      const response = await axios.get(requestUrl, { timeout: 10000 });
      logger.debug("Google Image API response received.", { 
        status: response.status,
        itemsReturned: response.data?.items?.length || 0
      });
      
      return {
        items: response.data?.items || []
      };
    } catch (apiError) {
      logger.error("Google API request failed.", {
        ...serializeError(apiError, { includeStack: true }),
        status: apiError.response?.status
      });

      return {
        error: true,
        message: formatApiError(apiError)
      };
    }
  },
  
  /**
   * Generates an embed for displaying an image search result.
   * 
   * @param {Array} items - Array of search result items
   * @param {number} index - Index of the current result to display
   * @returns {EmbedBuilder} Discord embed with image preview and metadata
   */
  async generateImageEmbed(items, index, query = '') {
    const item = items[index];
    const title = item.title || 'No Title';
    const imageLink = item.link || '';
    const pageLink = item.image?.contextLink || imageLink;

    const embed = new EmbedBuilder()
      .setTitle(truncateEmbedTitle(title))
      .setColor(0x4285F4)
      .setFooter({ text: `Powered by Google Image Search • Result ${index + 1} of ${items.length}` });

    if (imageLink) {
      embed.setImage(imageLink);
    }

    const linkFields = [];
    if (pageLink) {
      linkFields.push({ name: 'Source', value: `[View page](${pageLink})`, inline: true });
    }
    if (imageLink && imageLink !== pageLink) {
      linkFields.push({ name: 'Image', value: `[Direct link](${imageLink})`, inline: true });
    }
    if (linkFields.length > 0) {
      embed.addFields(linkFields);
    }

    if (config.googleImagesAiEnabled && query) {
      const aiContext = await fetchGoogleImagesContext({
        query,
        title,
        contextLink: pageLink || '',
        imageLink: imageLink || '',
        resultIndex: index
      });
      const aiField = formatAiContextField(aiContext?.note);
      if (aiField) {
        embed.addFields(aiField);
      }
    }

    return embed;
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
    logger.error("Error occurred in googleimages command.", { ...serializeError(error, { includeStack: true }),
      userId: interaction.user?.id,
      guildId: interaction.guild?.id,
      channelId: interaction.channel?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while searching for images. Please try again later.";
    
    if (error.message.includes('API')) {
      errorMessage = "⚠️ Failed to fetch search results. Please try again later.";
    } else if (error.message.includes('network')) {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    } else if (error.message.includes('rate limit')) {
      errorMessage = "⚠️ Rate limit exceeded. Please try again in a few minutes.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for googleimages command.", { ...serializeError(followUpError, { includeStack: true }),
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