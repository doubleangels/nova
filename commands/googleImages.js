const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

// Configuration constants
const SEARCH_API_URL = "https://www.googleapis.com/customsearch/v1";
const DEFAULT_RESULTS_COUNT = 5;
const MAX_RESULTS = 10;
const MIN_RESULTS = 1;
const COLLECTOR_TIMEOUT = 120000; // 2 minute timeout
const EMBED_COLOR = 0x4285F4; // Google blue color
const SAFE_SEARCH = "medium"; // Can be "off", "medium", or "high"

/**
 * Converts a string to title case.
 * @param {string} str - The input string.
 * @returns {string} The title-cased string.
 */
const titleCase = str =>
  str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('googleimages')
    .setDescription('Search Google for images and return the top results.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What images do you want to search for?')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('results')
        .setDescription(`How many results do you want? (${MIN_RESULTS}-${MAX_RESULTS}, Default: ${DEFAULT_RESULTS_COUNT})`)
        .setRequired(false)
    ),

  /**
   * Executes the /googleimages command.
   * Searches for images on Google using the Custom Search API and returns the results in a single paginated embed.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Validate API configuration before proceeding.
      if (!config.googleApiKey || !config.imageSearchEngineId) {
        logger.error("Google API configuration is missing.", {
          hasApiKey: !!config.googleApiKey,
          hasSearchEngineId: !!config.imageSearchEngineId
        });
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          ephemeral: true
        });
      }

      // Defer the reply to allow time for API processing.
      await interaction.deferReply();
      logger.info(`/googleimages command initiated.`, { 
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      // Retrieve user input for the query and number of results.
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? DEFAULT_RESULTS_COUNT;
      logger.debug("Processing user input.", { query, requestedResults: resultsCount });

      // Validate the query has non-whitespace content.
      if (!query || query.trim().length === 0) {
        logger.warn("Empty query provided.", { userId: interaction.user.id });
        return await interaction.editReply({
          content: "⚠️ Please provide a valid search query.",
          ephemeral: true
        });
      }

      // Format the query to title case and trim extra whitespace.
      const formattedQuery = titleCase(query.trim());
      // Ensure resultsCount is between MIN_RESULTS and MAX_RESULTS.
      resultsCount = Math.max(MIN_RESULTS, Math.min(resultsCount, MAX_RESULTS));
      logger.debug("Formatted search parameters.", { formattedQuery, resultsCount });

      // Construct the Google Custom Search API URL and parameters.
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.imageSearchEngineId,
        q: formattedQuery,
        searchType: "image",
        num: resultsCount.toString(),
        start: "1",
        safe: SAFE_SEARCH
      });
      const requestUrl = `${SEARCH_API_URL}?${params.toString()}`;
      logger.debug("Preparing Google Image API request.", { 
        searchQuery: formattedQuery,
        resultsRequested: resultsCount
      });

      // Make the API request using axios.
      let response;
      try {
        response = await axios.get(requestUrl);
        logger.debug("Google Image API response received.", { 
          status: response.status,
          itemsReturned: response.data?.items?.length || 0
        });
      } catch (apiError) {
        logger.error("Google API request failed.", { 
          error: apiError.message,
          status: apiError.response?.status,
          errorDetails: apiError.response?.data
        });
        const statusCode = apiError.response?.status || "unknown";
        const errorMessage = apiError.response?.data?.error?.message || apiError.message;
        return await interaction.editReply({
          content: `⚠️ Google API error (${statusCode}): ${errorMessage}`,
          ephemeral: true
        });
      }

      // If we have a successful response, process the results.
      const data = response.data;

      // Check if any image results were returned.
      if (data.items && data.items.length > 0) {
        // Save the items for pagination.
        const items = data.items;
        let currentIndex = 0;

        logger.info("Image search results found.", { 
          query: formattedQuery, 
          resultsCount: items.length 
        });

        // Helper function to create an embed for a given index.
        const generateEmbed = (index) => {
          const item = items[index];
          const title = item.title || "No Title";
          // Ensure we have a valid image link.
          const imageLink = item.link || "";
          // Use contextLink if available, otherwise fallback to the image link.
          const pageLink = item.image?.contextLink || imageLink;
          
          return new EmbedBuilder()
            .setTitle(`🖼️ ${title}`)
            .setDescription(`🔗 **[View Original Source](${pageLink})**`)
            .setColor(EMBED_COLOR)
            .setImage(imageLink)
            .setFooter({ text: `Result ${index + 1} of ${items.length} • Powered by Google Image Search` });
        };

        // Create arrow buttons for navigation.
        const createArrowButtons = (currentIndex) => {
          const prevButton = new ButtonBuilder()
            .setCustomId(`img_prev_${interaction.user.id}_${Date.now()}`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentIndex === 0); // Disable when on first item
            
          const nextButton = new ButtonBuilder()
            .setCustomId(`img_next_${interaction.user.id}_${Date.now()}`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentIndex === items.length - 1); // Disable when on last item
          
          return new ActionRowBuilder().addComponents(prevButton, nextButton);
        };

        // Send the initial embed with buttons.
        const message = await interaction.editReply({ 
          embeds: [generateEmbed(currentIndex)], 
          components: [createArrowButtons(currentIndex)] 
        });

        // Create a collector to handle button interactions.
        const filter = i => 
          (i.customId.startsWith('img_prev_') || 
           i.customId.startsWith('img_next_')) && 
          i.customId.includes(interaction.user.id) &&
          i.user.id === interaction.user.id;

        const collector = message.createMessageComponentCollector({ 
          filter, 
          time: COLLECTOR_TIMEOUT,
          idle: 60000 // Expire after 1 minute of inactivity
        });
        
        collector.on('collect', async i => {
          const buttonType = i.customId.split('_')[1];
          
          logger.debug("Navigation button pressed.", {
            buttonType,
            currentIndex,
            userId: i.user.id
          });
          
          if (buttonType === 'prev') {
            // Previous button clicked.
            currentIndex = Math.max(0, currentIndex - 1);
          } else if (buttonType === 'next') {
            // Next button clicked.
            currentIndex = Math.min(items.length - 1, currentIndex + 1);
          }
          
          await i.update({ 
            embeds: [generateEmbed(currentIndex)],
            components: [createArrowButtons(currentIndex)]
          });
        });

        // Disable buttons after the collector expires.
        collector.on('end', async (collected) => {
          logger.debug("Button collector ended.", {
            reason: collected.size ? "timeout" : "idle",
            totalInteractions: collected.size,
            userId: interaction.user.id
          });
          
          const disabledPrevButton = new ButtonBuilder()
            .setCustomId(`img_prev_disabled`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true);
            
          const disabledNextButton = new ButtonBuilder()
            .setCustomId(`img_next_disabled`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true);
          
          const disabledNavRow = new ActionRowBuilder().addComponents(
            disabledPrevButton, disabledNextButton
          );
          
          await interaction.editReply({
            components: [disabledNavRow]
          }).catch(err => logger.error("Failed to update timed out message.", { error: err.message }));
        });
      } else {
        // Inform the user if no images were found.
        logger.warn("No image results found for query.", { query: formattedQuery });
        await interaction.editReply({
          content: `⚠️ No images found for **${formattedQuery}**. Try refining your search query.`
        });
      }
    } catch (error) {
      // Log any unexpected errors and notify the user.
      logger.error("Error executing /googleimages command.", { 
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later."
      });
    }
  }
};
