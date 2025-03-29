const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
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
              .setTitle(`🔍 **${title}**`)
              .setDescription(`📜 **Summary:** ${snippet}\n🔗 [Read More](${link})`)
              .setColor(0x4285F4) // Google blue color
              .setFooter({ text: `Result ${index + 1} of ${items.length} • Powered by Google Search` });
          };

          // Create arrow buttons for navigation
          const createArrowButtons = (currentIndex) => {
            const prevButton = new ButtonBuilder()
              .setCustomId(`search_prev_${interaction.user.id}`)
              .setLabel('◀')
              .setStyle(ButtonStyle.Primary) // Google blue
              .setDisabled(currentIndex === 0); // Disable when on first item
              
            const nextButton = new ButtonBuilder()
              .setCustomId(`search_next_${interaction.user.id}`)
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
            (i.customId.startsWith('search_prev_') || 
             i.customId.startsWith('search_next_')) && 
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
            }).catch(err => logger.error("Failed to update timed out message:", err));
          });
        } else {
          logger.warn("No search results found:", { query: formattedQuery });
          await interaction.editReply({ content: `❌ No search results found for **${formattedQuery}**. Try refining your query!`, flags: MessageFlags.Ephemeral });
        }
      } else {
        const errorBody = response.data;
        logger.warn("Google API error:", { status: response.status, errorBody });
        await interaction.editReply({ content: `⚠️ Error: Google API returned status code ${response.status}.`, flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      logger.error("Error in /google command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", flags: MessageFlags.Ephemeral });
    }
  }
};
