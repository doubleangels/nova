const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

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
      // Defer reply to allow processing time.
      await interaction.deferReply();
      logger.debug("/google command received:", { user: interaction.user.tag });

      // Get query and results count.
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? 5;
      logger.debug("User input:", { query, requestedResults: resultsCount });

      // Trim the query and enforce result count boundaries.
      const formattedQuery = query.trim();
      resultsCount = Math.max(1, Math.min(resultsCount, 10));
      logger.debug("Formatted input:", { formattedQuery, resultsCount });

      // Build the Google Custom Search API request.
      const searchUrl = "https://www.googleapis.com/customsearch/v1";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.searchEngineId,
        q: formattedQuery,
        num: resultsCount.toString(),
        start: "1"
      });
      const requestUrl = `${searchUrl}?${params.toString()}`;
      logger.debug("Making Google API request:", { requestUrl });

      // Fetch data from the API using axios.
      const response = await axios.get(requestUrl);
      logger.debug("Google API response:", { status: response.status });

      if (response.status === 200) {
        // Parse the JSON response.
        const data = response.data;
        logger.debug("Received Google Search data:", { data });

        if (data.items && data.items.length > 0) {
          // Store the search results.
          const items = data.items;
          let currentIndex = 0;

          // Helper function to generate an embed for the current result.
          const generateEmbed = (index) => {
            const item = items[index];
            const title = item.title || "No Title Found";
            const link = item.link || "No Link Found";
            const snippet = item.snippet || "No Description Found";
            return new EmbedBuilder()
              .setTitle(`🔍 **${title}** (${index + 1}/${items.length})`)
              .setDescription(`📜 **Summary:** ${snippet}\n🔗 [Read More](${link})`)
              .setColor(0x1A73E8)
              .setFooter({ text: "Powered by Google Search" });
          };

          // Create pagination buttons.
          const previousButton = new ButtonBuilder()
            .setCustomId('previous')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true); // Disable since first result is shown initially.

          const nextButton = new ButtonBuilder()
            .setCustomId('next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(items.length <= 1); // Disable if only one result.

          const row = new ActionRowBuilder().addComponents(previousButton, nextButton);

          // Send the initial embed.
          const message = await interaction.editReply({ embeds: [generateEmbed(currentIndex)], components: [row] });

          // Create a collector to handle button interactions.
          const collector = message.createMessageComponentCollector({ time: 60000 });
          collector.on('collect', async i => {
            // Restrict button usage to the command invoker.
            if (i.user.id !== interaction.user.id) {
              await i.reply({ content: "These buttons aren't for you!", ephemeral: true });
              return;
            }

            // Update index based on the button pressed.
            if (i.customId === 'previous') {
              currentIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
            } else if (i.customId === 'next') {
              currentIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
            }

            // Update button disabled states if you want non-wrap-around behavior.
            previousButton.setDisabled(currentIndex === 0);
            nextButton.setDisabled(currentIndex === items.length - 1);

            // Update the embed with the new result.
            await i.update({ embeds: [generateEmbed(currentIndex)], components: [row] });
          });

          // When collector ends, disable the buttons.
          collector.on('end', async () => {
            previousButton.setDisabled(true);
            nextButton.setDisabled(true);
            await interaction.editReply({ components: [row] });
          });
        } else {
          logger.warn("No search results found:", { query: formattedQuery });
          await interaction.editReply(`❌ No search results found for **${formattedQuery}**. Try refining your query!`);
        }
      } else {
        const errorBody = response.data;
        logger.warn("Google API error:", { status: response.status, errorBody });
        await interaction.editReply(`⚠️ Error: Google API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error("Error in /google command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
