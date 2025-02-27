const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

/**
 * Module for the /google command.
 * This command searches Google using the Custom Search API and returns the top results as embeds.
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
      logger.debug(`/google command received from ${interaction.user.tag}`);
      
      // Retrieve query and results count options from the command.
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? 5;
      logger.debug(`User input: query='${query}', requested results=${resultsCount}`);

      // Trim the query and ensure the results count is within valid range.
      const formattedQuery = query.trim();
      resultsCount = Math.max(1, Math.min(resultsCount, 10));
      logger.debug(`Formatted query: '${formattedQuery}', adjusted results count: ${resultsCount}`);

      // Construct the Google Custom Search API URL with necessary parameters.
      const searchUrl = "https://www.googleapis.com/customsearch/v1";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.searchEngineId,
        q: formattedQuery,
        num: resultsCount.toString()
      });
      logger.debug(`Making Google API request to: ${searchUrl}?${params.toString()}`);

      // Fetch data from Google API.
      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`Google API Response Status: ${response.status}`);

      if (response.ok) {
        // Parse the response as JSON.
        const data = await response.json();
        logger.debug(`Received Google Search data: ${JSON.stringify(data, null, 2)}`);

        // Check if search results exist and create embeds for each result.
        if (data.items && data.items.length > 0) {
          const embeds = data.items.map(item => {
            const title = item.title || "No Title Found";
            const link = item.link || "No Link Found";
            const snippet = item.snippet || "No Description Found";
            logger.debug(`Search result - Title: ${title}, Link: ${link}`);

            return new EmbedBuilder()
              .setTitle(`🔍 **${title}**`)
              .setDescription(`📜 **Summary:** ${snippet}\n🔗 [Read More](${link})`)
              .setColor(0x1A73E8)
              .setFooter({ text: "Powered by Google Search" });
          });
          // Send the embeds as the response.
          await interaction.editReply({ embeds });
        } else {
          // Inform the user if no search results were found.
          logger.warn(`No search results found for query: '${formattedQuery}'`);
          await interaction.editReply(`❌ No search results found for **${formattedQuery}**. Try refining your query!`);
        }
      } else {
        // Log and inform the user if the API response is not OK.
        logger.warn(`Google API error: ${response.status}`);
        await interaction.editReply(`⚠️ Error: Google API returned status code ${response.status}.`);
      }
    } catch (e) {
      // Log unexpected errors and notify the user.
      logger.error(`Error in /google command: ${e}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
