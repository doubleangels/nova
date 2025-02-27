const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

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
    .setName('googleimage')
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
        .setDescription('How many results do you want? (1-10, Default: 5)')
        .setRequired(false)
    ),
    
  /**
   * Executes the /googleimage command.
   * Searches for images on Google using the Custom Search API and returns the results in embeds.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for API processing.
      await interaction.deferReply();
      logger.debug(`/googleimage command received from ${interaction.user.tag}`);
      
      // Retrieve user input for the query and number of results.
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? 5;
      logger.debug(`User input: query='${query}', requested results=${resultsCount}`);

      // Format the query to title case and trim extra whitespace.
      const formattedQuery = titleCase(query.trim());
      // Ensure resultsCount is between 1 and 10.
      resultsCount = Math.max(1, Math.min(resultsCount, 10));
      logger.debug(`Formatted query: '${formattedQuery}', adjusted results count: ${resultsCount}`);

      // Construct the Google Custom Search API URL and parameters.
      const searchUrl = "https://www.googleapis.com/customsearch/v1";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.imageSearchEngineId,
        q: query,
        searchType: "image",
        num: resultsCount.toString()
      });
      logger.debug(`Making Google Image API request to: ${searchUrl}?${params.toString()}`);

      // Make the API request.
      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`Google Image API Response Status: ${response.status}`);

      if (response.ok) {
        // Parse the API response as JSON.
        const data = await response.json();
        logger.debug(`Received Google Image data: ${JSON.stringify(data, null, 2)}`);

        // Check if any image results were returned.
        if (data.items && data.items.length > 0) {
          // Map each result to an embed.
          const embeds = data.items.map(item => {
            const title = item.title || "No Title";
            const imageLink = item.link || "";
            // Use contextLink if available, otherwise fallback to the image link.
            const pageLink = item.image && item.image.contextLink ? item.image.contextLink : imageLink;
            logger.debug(`Image result - Title: ${title}, Image Link: ${imageLink}`);
            return new EmbedBuilder()
              .setTitle(`🖼️ **${title}**`)
              .setDescription(`🔗 **[View Image](${imageLink})**`)
              .setColor(0x1A73E8)
              .setImage(imageLink)
              .setFooter({ text: "Powered by Google Image Search" });
          });
          // Edit the deferred reply with the embeds.
          await interaction.editReply({ embeds });
        } else {
          // Inform the user if no images were found.
          logger.warn(`No image results found for query: '${formattedQuery}'`);
          await interaction.editReply(`❌ No images found for **${formattedQuery}**. Try refining your query!`);
        }
      } else {
        // If the API returns an error, log the error details.
        const errorBody = await response.text();
        logger.warn(`Google API error: ${response.status} - ${errorBody}`);
        await interaction.editReply(`⚠️ Error: Google API returned status code ${response.status}.`);
      }
    } catch (e) {
      // Log any unexpected errors and notify the user.
      logger.error(`Error in /googleimage command: ${e}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
