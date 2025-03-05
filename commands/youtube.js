const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../logger')('youtube.js');
const axios = require('axios');
const config = require('../config');

/**
 * Module for the /youtube command.
 * Searches YouTube for videos related to a given query and returns the top result.
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
      logger.debug("/youtube command received:", { user: interaction.user.tag });
      
      // Retrieve and format the user's search query.
      const query = interaction.options.getString('query');
      logger.debug("User input for query:", { query });
      
      const formattedQuery = query.trim();
      logger.debug("Formatted query:", { formattedQuery });

      // Construct the YouTube API URL with the required parameters.
      const searchUrl = "https://www.googleapis.com/youtube/v3/search";
      const params = new URLSearchParams({
        key: config.googleApiKey,
        part: "snippet",
        q: formattedQuery,
        type: "video",
        maxResults: "1",
      });
      const requestUrl = `${searchUrl}?${params.toString()}`;
      logger.debug("Making YouTube API request:", { requestUrl });
      
      // Make the API request using axios.
      const response = await axios.get(requestUrl);
      logger.debug("YouTube API response:", { status: response.status });
      
      if (response.status === 200) {
        // Parse the JSON response.
        const data = response.data;
        logger.debug("Received YouTube data:", { data });
        
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
          logger.debug("Extracted YouTube video details:", { title, videoId });
          
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
          
          // Send the embed as the reply.
          await interaction.editReply({ embeds: [embed] });
          logger.debug("YouTube embed sent successfully:", { user: interaction.user.tag, title });
        } else {
          // No video results found.
          logger.warn("No video results found:", { query: formattedQuery });
          await interaction.editReply(`❌ No video results found for **${formattedQuery}**. Try another search!`);
        }
      } else {
        // Handle API error responses.
        logger.warn("YouTube API error:", { status: response.status });
        await interaction.editReply(`⚠️ Error: YouTube API returned status code ${response.status}.`);
      }
    } catch (error) {
      // Log and report any unexpected errors.
      logger.error("Error in /youtube command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
