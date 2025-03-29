const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
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
        .setDescription('How many results do you want? (1-10, Default: 5)')
        .setRequired(false)
    ),

  /**
   * Executes the /googleimage command.
   * Searches for images on Google using the Custom Search API and returns the results in a single paginated embed.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
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
              .setTitle(`🖼️ **${title}**`)
              .setDescription(`🔗 **[View Image](${imageLink})**`)
              .setColor(0x4285F4) // Google blue color
              .setImage(imageLink)
              .setFooter({ text: `Result ${index + 1} of ${items.length} • Powered by Google Image Search` });
          };

          // Create arrow buttons for navigation
          const createArrowButtons = (currentIndex) => {
            const prevButton = new ButtonBuilder()
              .setCustomId(`img_prev_${interaction.user.id}`)
              .setLabel('◀')
              .setStyle(ButtonStyle.Primary) // Google blue
              .setDisabled(currentIndex === 0); // Disable when on first item
              
            const nextButton = new ButtonBuilder()
              .setCustomId(`img_next_${interaction.user.id}`)
              .setLabel('▶')
              .setStyle(ButtonStyle.Primary) // Google blue
              .setDisabled(currentIndex === items.length - 1); // Disable when on last item
            
            const navRow = new ActionRowBuilder().addComponents(prevButton, nextButton);
            return navRow;
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

          const collector = message.createMessageComponentCollector({ filter, time: 120000 }); // 2 minute timeout
          
          collector.on('collect', async i => {
            const buttonType = i.customId.split('_')[1];
            
            if (buttonType === 'prev') {
              // Previous button clicked
              currentIndex = Math.max(0, currentIndex - 1);
            } else if (buttonType === 'next') {
              // Next button clicked
              currentIndex = Math.min(items.length - 1, currentIndex + 1);
            }
            
            await i.update({ 
              embeds: [generateEmbed(currentIndex)],
              components: [createArrowButtons(currentIndex)]
            });
          });

          // Disable buttons after the collector expires.
          collector.on('end', async () => {
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
            }).catch(err => logger.error("Failed to update timed out message:", err));
          });
        } else {
          // Inform the user if no images were found.
          logger.warn("No image results found:", { query: formattedQuery });
          avw
          await interaction.editReply({
            content: `⚠️ No images found for **${formattedQuery}**. Try refining your query!`,
            flags: MessageFlags.Ephemeral
          });
        }
      } else {
        // If the API returns an error, log the error details.
        const errorBody = response.data;
        logger.warn("Google API error:", { status: response.status, errorBody });
        await interaction.editReply({
          content: `⚠️ Error: Google API returned status code ${response.status}.`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (error) {
      // Log any unexpected errors and notify the user.
      logger.error("Error in /googleimage command:", { error });
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
