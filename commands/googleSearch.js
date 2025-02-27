const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
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
  async execute(interaction) {
    try {
      await interaction.deferReply();
      logger.debug(`/google command received from ${interaction.user.tag}`);
      
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? 5;
      logger.debug(`User input: query='${query}', requested results=${resultsCount}`);

      const formattedQuery = query.trim();
      resultsCount = Math.max(1, Math.min(resultsCount, 10));
      logger.debug(`Formatted query: '${formattedQuery}', adjusted results count: ${resultsCount}`);

      const searchUrl = "https://www.googleapis.com/customsearch/v1";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.searchEngineId,
        q: formattedQuery,
        num: resultsCount.toString()
      });
      logger.debug(`Making Google API request to: ${searchUrl}?${params.toString()}`);

      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`Google API Response Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        logger.debug(`Received Google Search data: ${JSON.stringify(data, null, 2)}`);

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
          await interaction.editReply({ embeds });
        } else {
          logger.warn(`No search results found for query: '${formattedQuery}'`);
          await interaction.editReply(`❌ No search results found for **${formattedQuery}**. Try refining your query!`);
        }
      } else {
        logger.warn(`Google API error: ${response.status}`);
        await interaction.editReply(`⚠️ Error: Google API returned status code ${response.status}.`);
      }
    } catch (e) {
      logger.error(`Error in /google command: ${e}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
