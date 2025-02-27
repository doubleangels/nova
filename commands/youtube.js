const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

/**
 * Module for the /youtube command.
 * This command searches YouTube for videos related to a given query and returns the top result.
 */
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
    
  /**
   * Executes the /youtube command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for the API call.
      await interaction.deferReply();
      logger.debug(`/youtube command received from ${interaction.user.tag}`);
      
      // Retrieve and format the user's search query.
      const query = interaction.options.getString('query');
      logger.debug(`User input for query: '${query}'`);
      
      const formattedQuery = query.trim();
      logger.debug(`Formatted query: '${formattedQuery}'`);

      // Construct the YouTube API URL with the required parameters.
      const searchUrl = "https://www.googleapis.com/youtube/v3/search";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        part: "snippet",
        q: formattedQuery,
        type: "video",
        maxResults: "1"
      });
      logger.debug(`Making YouTube API request to: ${searchUrl}?${params.toString()}`);

      // Make the API request.
      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`YouTube API Response Status: ${response.status}`);

      if (response.ok) {
        // Parse the JSON response.
        const data = await response.json();
        logger.debug(`Received YouTube data: ${JSON.stringify(data, null, 2)}`);

        // Check if the API returned any items.
        if (data.items && data.items.length > 0) {
          const item = data.items[0];
          // Extract video details.
          const videoId = item.id.videoId || "";
          const snippet = item.snippet;
          const title = snippet.title || "No Title";
          const description = snippet.description || "No Description";
          // Use a high resolution thumbnail if available.
          const thumbnail = snippet.thumbnails && snippet.thumbnails.high ? snippet.thumbnails.high.url : "";
          const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "N/A";
          logger.debug(`Extracted YouTube Video - Title: ${title}, Video ID: ${videoId}`);

          // Build an embed with the video details.
          const embed = new EmbedBuilder()
            .setTitle(`🎬 **${title}**`)
            .setDescription(`📜 **Description:** ${description}`)
            .setURL(videoUrl)
            .setColor(0xFF0000)
            .addFields({ name: "🔗 Watch on YouTube", value: `[Click Here](${videoUrl})`, inline: false })
            .setFooter({ text: "Powered by YouTube Data API" });
          
          // Set the thumbnail if available.
          if (thumbnail) {
            embed.setThumbnail(thumbnail);
          }
          
          // Send the embed as the response.
          await interaction.editReply({ embeds: [embed] });
        } else {
          // No video results found.
          logger.warn(`No video results found for query: '${formattedQuery}'`);
          await interaction.editReply(`❌ No video results found for **${formattedQuery}**. Try another search!`);
        }
      } else {
        // Handle API error responses.
        const errorBody = await response.text();
        logger.warn(`YouTube API error: ${response.status} - ${errorBody}`);
        await interaction.editReply(`⚠️ Error: YouTube API returned status code ${response.status}.`);
      }
    } catch (error) {
      // Log and report any unexpected errors.
      logger.error(`Error in /youtube command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
