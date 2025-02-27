const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch').default;
const logger = require('../logger');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Search YouTube for videos and return the top result.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What videos do you want to search for?')
        .setRequired(true)
    ),
  async execute(interaction) {
    try {
      await interaction.deferReply();
      logger.debug(`/youtube command received from ${interaction.user.tag}`);
      
      const query = interaction.options.getString('query');
      logger.debug(`User input for query: '${query}'`);
      
      const formattedQuery = query.trim();
      logger.debug(`Formatted query: '${formattedQuery}'`);

      const searchUrl = "https://www.googleapis.com/youtube/v3/search";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        part: "snippet",
        q: formattedQuery,
        type: "video",
        maxResults: "1"
      });
      logger.debug(`Making YouTube API request to: ${searchUrl}?${params.toString()}`);

      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`YouTube API Response Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        logger.debug(`Received YouTube data: ${JSON.stringify(data, null, 2)}`);

        if (data.items && data.items.length > 0) {
          const item = data.items[0];
          const videoId = item.id.videoId || "";
          const snippet = item.snippet;
          const title = snippet.title || "No Title";
          const description = snippet.description || "No Description";
          const thumbnail = snippet.thumbnails && snippet.thumbnails.high ? snippet.thumbnails.high.url : "";
          const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "N/A";
          logger.debug(`Extracted YouTube Video - Title: ${title}, Video ID: ${videoId}`);

          const embed = new EmbedBuilder()
            .setTitle(`🎬 **${title}**`)
            .setDescription(`📜 **Description:** ${description}`)
            .setURL(videoUrl)
            .setColor(0xFF0000)
            .addFields({ name: "🔗 Watch on YouTube", value: `[Click Here](${videoUrl})`, inline: false })
            .setFooter({ text: "Powered by YouTube Data API" });
          
          if (thumbnail) {
            embed.setThumbnail(thumbnail);
          }
          
          await interaction.editReply({ embeds: [embed] });
        } else {
          logger.warn(`No video results found for query: '${formattedQuery}'`);
          await interaction.editReply(`❌ No video results found for **${formattedQuery}**. Try another search!`);
        }
      } else {
        const errorBody = await response.text();
        logger.warn(`YouTube API error: ${response.status} - ${errorBody}`);
        await interaction.editReply(`⚠️ Error: YouTube API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error(`Error in /youtube command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
