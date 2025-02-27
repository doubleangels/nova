const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch').default;
const logger = require('../logger');
const config = require('../config');

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
  async execute(interaction) {
    try {
      await interaction.deferReply();
      logger.debug(`/googleimage command received from ${interaction.user.tag}`);
      
      const query = interaction.options.getString('query');
      let resultsCount = interaction.options.getInteger('results') ?? 5;
      logger.debug(`User input: query='${query}', requested results=${resultsCount}`);

      const formattedQuery = titleCase(query.trim());
      resultsCount = Math.max(1, Math.min(resultsCount, 10));
      logger.debug(`Formatted query: '${formattedQuery}', adjusted results count: ${resultsCount}`);

      const searchUrl = "https://www.googleapis.com/customsearch/v1";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        cx: config.imageSearchEngineId,
        q: query,
        searchType: "image",
        num: resultsCount.toString()
      });
      logger.debug(`Making Google Image API request to: ${searchUrl}?${params.toString()}`);

      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`Google Image API Response Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        logger.debug(`Received Google Image data: ${JSON.stringify(data, null, 2)}`);

        if (data.items && data.items.length > 0) {
          const embeds = data.items.map(item => {
            const title = item.title || "No Title";
            const imageLink = item.link || "";
            const pageLink = item.image && item.image.contextLink ? item.image.contextLink : imageLink;
            logger.debug(`Image result - Title: ${title}, Image Link: ${imageLink}`);
            return new EmbedBuilder()
              .setTitle(`🖼️ **${title}**`)
              .setDescription(`🔗 **[View Image](${imageLink})**`)
              .setColor(0x1A73E8)
              .setImage(imageLink)
              .setFooter({ text: "Powered by Google Image Search" });
          });
          await interaction.editReply({ embeds });
        } else {
          logger.warn(`No image results found for query: '${formattedQuery}'`);
          await interaction.editReply(`❌ No images found for **${formattedQuery}**. Try refining your query!`);
        }
      } else {
        const errorBody = await response.text();
        logger.warn(`Google API error: ${response.status} - ${errorBody}`);
        await interaction.editReply(`⚠️ Error: Google API returned status code ${response.status}.`);
      }
    } catch (e) {
      logger.error(`Error in /googleimage command: ${e}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
