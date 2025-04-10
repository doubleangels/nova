const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

// Configuration constants
const API_URL = 'https://www.googleapis.com/customsearch/v1';
const DEFAULT_RESULTS = 5;
const MIN_RESULTS = 1;
const MAX_RESULTS = 10;
const COLLECTOR_TIMEOUT = 120000; // 2 minute timeout
const EMBED_COLOR = 0x4285F4; // Google blue color
const REQUEST_TIMEOUT = 10000; // 10 second API request timeout
const SAFE_SEARCH = 'medium'; // Options: 'off', 'medium', 'high'

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
        .setDescription(`How many results do you want? (${MIN_RESULTS}-${MAX_RESULTS}, Default: ${DEFAULT_RESULTS})`)
        .setRequired(false)
    ),

  /**
   * Executes the /google command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Validate API configuration.
      if (!config.googleApiKey || !config.searchEngineId) {
        logger.error("Google API configuration is missing.", {
          hasApiKey: !!config.googleApiKey,
          hasSearchEngineId: !!config.searchEngineId
        });
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact a server administrator.",
          ephemeral: true
        });
      }

      // Defer reply to allow processing time.
      await interaction.deferReply();
      logger.info(`/google command initiated.`, { 
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      // Get query and results count.
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? DEFAULT_RESULTS;
      logger.debug("Processing user input.", { 
        query, 
        requestedResults: resultsCount 
      });

      // Validate the query has non-whitespace content.
      if (!query || query.trim().length === 0) {
        logger.warn("Empty query provided.", { userId: interaction.user.id });
        return await interaction.editReply({
          content: "⚠️ Please provide a valid search query.",
          ephemeral: true
        });
      }

      // Trim the query and enforce result count boundaries.
      const formattedQuery = query.trim();
      resultsCount = Math.max(MIN_RESULTS, Math.min(resultsCount, MAX_RESULTS));
      logger.debug("Formatted search parameters.", { 
        formattedQuery, 
        resultsCount 
      });

      // Build the Google Custom Search API request.
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.searchEngineId,
        q: formattedQuery,
        num: resultsCount.toString(),
        start: "1",
        safe: SAFE_SEARCH
      });
      const requestUrl = `${API_URL}?${params.toString()}`;
      logger.debug("Preparing Google API request.", { 
        searchQuery: formattedQuery,
        resultsRequested: resultsCount
      });

      // Fetch data from the API using axios.
      let response;
      try {
        response = await axios.get(requestUrl, { timeout: REQUEST_TIMEOUT });
        logger.debug("Google API response received.", { 
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

      // Parse the JSON response.
      const data = response.data;

      if (data.items && data.items.length > 0) {
        // Store the search results.
        const items = data.items;
        let currentIndex = 0;

        logger.info("Search results found.", { 
          query: formattedQuery, 
          resultsCount: items.length 
        });

        // Helper function to generate an embed for the current result.
        const generateEmbed = (index) => {
          const item = items[index];
          const title = item.title || "No Title Found";
          const link = item.link || "No Link Found";
          const snippet = item.snippet || "No Description Found";
          return new EmbedBuilder()
            .setTitle(`🔍 ${title}`)
            .setDescription(`📜 **Summary:** ${snippet}\n🔗 [Read More](${link})`)
            .setColor(EMBED_COLOR)
            .setFooter({ text: `Result ${index + 1} of ${items.length} • Powered by Google Search` });
        };

        // Create arrow buttons for navigation.
        const createArrowButtons = (currentIndex) => {
          const timestamp = Date.now(); // Add timestamp to prevent button ID collisions
          const prevButton = new ButtonBuilder()
            .setCustomId(`search_prev_${interaction.user.id}_${timestamp}`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentIndex === 0); // Disable when on first item
            
          const nextButton = new ButtonBuilder()
            .setCustomId(`search_next_${interaction.user.id}_${timestamp}`)
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
          (i.customId.startsWith('search_prev_') || 
           i.customId.startsWith('search_next_')) && 
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
            .setCustomId(`search_prev_disabled`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true);
            
          const disabledNextButton = new ButtonBuilder()
            .setCustomId(`search_next_disabled`)
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
        logger.warn("No search results found for query.", { query: formattedQuery });
        await interaction.editReply({ 
          content: `⚠️ No search results found for **${formattedQuery}**. Try refining your query!`
        });
      }
    } catch (error) {
      logger.error("Error executing /google command.", { 
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
