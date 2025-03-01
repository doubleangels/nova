const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
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
   * Searches for images on Google using the Custom Search API and returns the results in a single paginated embed.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    // Temporarily disable the command.
    await interaction.reply({ content: "⚠️ This command is temporarily disabled.", ephemeral: true });
      
    try {
      // Defer the reply to allow time for API processing.
      await interaction.deferReply();
      logger.debug("/googleimage command received:", { user: interaction.user.tag });

      // Retrieve user input for the query and number of results.
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? 5;
      logger.debug("User input:", { query, requestedResults: resultsCount });

      // Format the query to title case and trim extra whitespace.
      const formattedQuery = titleCase(query.trim());
      // Ensure resultsCount is between 1 and 10.
      resultsCount = Math.max(1, Math.min(resultsCount, 10));
      logger.debug("Formatted input:", { formattedQuery, resultsCount });

      // Construct the Google Custom Search API URL and parameters.
      const searchUrl = "https://www.googleapis.com/customsearch/v1";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.imageSearchEngineId,
        q: query,
        searchType: "image",
        num: resultsCount.toString(),
        start: "1"
      });
      const requestUrl = `${searchUrl}?${params.toString()}`;
      logger.debug("Making Google Image API request:", { requestUrl });

      // Make the API request using axios.
      const response = await axios.get(requestUrl);
      logger.debug("Google Image API response:", { status: response.status });

      if (response.status === 200) {
        // Parse the API response as JSON.
        const data = response.data;
        logger.debug("Received Google Image data:", { data });

        // Check if any image results were returned.
        if (data.items && data.items.length > 0) {
          // Save the items for pagination.
          const items = data.items;
          let currentIndex = 0;

          // Helper function to create an embed for a given index.
          const generateEmbed = (index) => {
            const item = items[index];
            const title = item.title || "No Title";
            const imageLink = item.link || "";
            // Use contextLink if available, otherwise fallback to the image link.
            const pageLink = item.image && item.image.contextLink ? item.image.contextLink : imageLink;
            return new EmbedBuilder()
              .setTitle(`🖼️ **${title}** (${index + 1}/${items.length})`)
              .setDescription(`🔗 **[View Image](${imageLink})**`)
              .setColor(0x1A73E8)
              .setImage(imageLink)
              .setFooter({ text: "Powered by Google Image Search" });
          };

          // Create buttons for pagination.
          const previousButton = new ButtonBuilder()
            .setCustomId('previous')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true); // start disabled since we're at the first item

          const nextButton = new ButtonBuilder()
            .setCustomId('next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(items.length <= 1); // disable if only one item

          const row = new ActionRowBuilder().addComponents(previousButton, nextButton);

          // Send the initial embed with buttons.
          const message = await interaction.editReply({ embeds: [generateEmbed(currentIndex)], components: [row] });

          // Create a collector to handle button interactions.
          const collector = message.createMessageComponentCollector({ time: 60000 });
          collector.on('collect', async i => {
            // Only allow the command user to interact.
            if (i.user.id !== interaction.user.id) {
              await i.reply({ content: "These buttons aren't for you!", ephemeral: true });
              return;
            }

            // Update currentIndex based on which button was clicked.
            if (i.customId === 'previous') {
              currentIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
            } else if (i.customId === 'next') {
              currentIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
            }

            // Optionally, adjust button disabled states if you don't want wrap-around.
            // For example, disable "Previous" on the first item and "Next" on the last item:
            previousButton.setDisabled(currentIndex === 0);
            nextButton.setDisabled(currentIndex === items.length - 1);

            // Update the embed with the new image.
            await i.update({ embeds: [generateEmbed(currentIndex)], components: [row] });
          });

          // Disable buttons after the collector expires.
          collector.on('end', async () => {
            previousButton.setDisabled(true);
            nextButton.setDisabled(true);
            await interaction.editReply({ components: [row] });
          });
        } else {
          // Inform the user if no images were found.
          logger.warn("No image results found:", { query: formattedQuery });
          await interaction.editReply(`❌ No images found for **${formattedQuery}**. Try refining your query!`);
        }
      } else {
        // If the API returns an error, log the error details.
        const errorBody = response.data;
        logger.warn("Google API error:", { status: response.status, errorBody });
        await interaction.editReply(`⚠️ Error: Google API returned status code ${response.status}.`);
      }
    } catch (error) {
      // Log any unexpected errors and notify the user.
      logger.error("Error in /googleimage command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
