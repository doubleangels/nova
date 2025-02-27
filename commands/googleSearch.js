const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

/**
 * Module for the /google command.
 * Searches Google using the Custom Search API and returns the top results as embeds.
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
   * Executes the /google command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for processing.
      await interaction.deferReply();
      logger.debug("/google command received", { user: interaction.user.tag });
      
      // Retrieve query and results count options.
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? 5;
      logger.debug("User input", { query, requestedResults: resultsCount });
      
      // Trim the query and ensure the results count is within valid range.
      const formattedQuery = query.trim();
      resultsCount = Math.max(1, Math.min(resultsCount, 10));
      logger.debug("Formatted input", { formattedQuery, resultsCount });
      
      // Construct the Google Custom Search API URL with necessary parameters.
      const searchUrl = "https://www.googleapis.com/customsearch/v1";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.searchEngineId,
        q: formattedQuery,
        num: resultsCount.toString()
      });
      const requestUrl = `${searchUrl}?${params.toString()}`;
      logger.debug("Making Google API request", { requestUrl });
      
      // Fetch data from the Google API.
      const response = await fetch(requestUrl);
      logger.debug("Google API response", { status: response.status });
      
      if (response.ok) {
        // Parse the response as JSON.
        const data = await response.json();
        logger.debug("Received Google Search data", { data });
        
        // Check if search results exist.
        if (data.items && data.items.length > 0) {
          const embeds = data.items.map(item => {
            const title = item.title || "No Title Found";
            const link = item.link || "No Link Found";
            const snippet = item.snippet || "No Description Found";
            logger.debug("Search result extracted", { title, link });
            
            return new EmbedBuilder()
              .setTitle(`🔍 **${title}**`)
              .setDescription(`📜 **Summary:** ${snippet}\n🔗 [Read More](${link})`)
              .setColor(0x1A73E8)
              .setFooter({ text: "Powered by Google Search" });
          });
          // Send the embeds as the reply.
          await interaction.editReply({ embeds });
          logger.debug("Google search results sent", { user: interaction.user.tag, resultCount: embeds.length });
        } else {
          // No results found.
          logger.warn("No search results found", { query: formattedQuery });
          await interaction.editReply(`❌ No search results found for **${formattedQuery}**. Try refining your query!`);
        }
      } else {
        // Log and notify if the API response is not OK.
        const errorBody = await response.text();
        logger.warn("Google API error", { status: response.status, errorBody });
        await interaction.editReply(`⚠️ Error: Google API returned status code ${response.status}.`);
      }
    } catch (error) {
      // Log and report unexpected errors.
      logger.error("Error in /google command", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
