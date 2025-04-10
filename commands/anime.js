const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');

/**
 * Module for the /anime command.
 * Searches for an anime on MyAnimeList based on the provided title,
 * retrieves its details, and sends an embed with the information.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('anime')
    .setDescription('Search for an anime on MyAnimeList.')
    .addStringOption(option =>
      option.setName('title')
        .setDescription('What anime do you want to search for?')
        .setRequired(true)
    ),
  
  /**
   * Executes the /anime command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer reply to allow additional processing time.
      await interaction.deferReply();
      logger.debug("/anime command received", { user: interaction.user.tag });

      // Retrieve and validate the anime title.
      const titleQuery = interaction.options.getString('title');
      
      if (titleQuery.length > 100) {
        logger.warn("Title query too long", { length: titleQuery.length });
        await interaction.editReply({
          content: "⚠️ Search query is too long. Please use a shorter title.",
          ephemeral: true
        });
        return;
      }
      
      const formattedTitle = titleQuery.trim();
      logger.debug("Searching for anime:", { formattedTitle });

      // Construct the search URL with expanded fields to reduce API calls
      const searchUrl = `https://api.myanimelist.net/v2/anime?q=${encodeURIComponent(formattedTitle)}&limit=1&fields=id,title,main_picture`;
      const headers = { "X-MAL-CLIENT-ID": config.malClientId };
      logger.debug("Making MAL search request");

      // Perform the search request using axios with timeout
      const searchResponse = await axios.get(searchUrl, { 
        headers,
        timeout: 5000 // 5 second timeout
      });

      if (searchResponse.status === 200) {
        const searchData = searchResponse.data;

        // Check for results.
        if (searchData.data && searchData.data.length > 0) {
          const animeNode = searchData.data[0].node;
          const animeId = animeNode.id;
          const animeTitle = animeNode.title || "Unknown";
          const imageUrl = animeNode.main_picture ? animeNode.main_picture.medium : null;
          const malLink = animeId ? `https://myanimelist.net/anime/${animeId}` : "N/A";

          // Construct the details URL with all needed fields
          const detailsUrl = `https://api.myanimelist.net/v2/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
          logger.debug("Making MAL details request for anime ID:", { animeId });

          // Request detailed anime information using axios with timeout
          const detailsResponse = await axios.get(detailsUrl, { 
            headers,
            timeout: 5000 // 5 second timeout
          });

          if (detailsResponse.status === 200) {
            const detailsData = detailsResponse.data;
            
            // Extract data with defaults in one step
            const {
              synopsis = "No synopsis available.",
              mean: rating = "N/A",
              genres: genresArray = [],
              start_date: startDate
            } = detailsData;

            const genres = genresArray.length > 0 ? genresArray.map(g => g.name).join(", ") : "Unknown";
            const releaseDate = startDate ? dayjs(startDate).format('YYYY') : "Unknown";
            
            logger.debug("Extracted anime details:", { animeTitle, rating });

            // Create an embed for the anime details.
            const embed = new EmbedBuilder()
              .setTitle(`📺 **${animeTitle} (${releaseDate})**`)
              .setDescription(`📜 **Synopsis:** ${synopsis}`)
              .setColor(0x2E51A2)
              .addFields(
                { name: "🎭 Genre", value: `🎞 ${genres}`, inline: true },
                { name: "⭐ MAL Rating", value: `🌟 ${rating}`, inline: true },
                { name: "🔗 MAL Link", value: `[Click Here](${malLink})`, inline: false }
              )
              .setFooter({ text: "Powered by MyAnimeList API" });
            
            if (imageUrl) {
              embed.setThumbnail(imageUrl);
            }
            
            // Send the embed back to the user.
            await interaction.editReply({ embeds: [embed] });
            logger.debug("Anime embed sent successfully");
          } else {
            logger.warn("Error fetching MAL details:", { detailsStatus: detailsResponse.status });
            await interaction.editReply({
              content: "⚠️ Error fetching additional anime details. Please try again later.",
              ephemeral: true
            });
          }
        } else {
          logger.warn("No anime results found:", { formattedTitle });
          await interaction.editReply({
            content: `⚠️ No anime found for **${formattedTitle}**. Try another title!`,
            ephemeral: true
          });
        }
      } else {
        logger.warn("MAL API search error:", { status: searchResponse.status });
        await interaction.editReply({
          content: `⚠️ Error: MAL API returned status code ${searchResponse.status}.`,
          ephemeral: true
        });
      }
    } catch (e) {
      logger.error("Error in /anime command:", { error: e });
      let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";
      
      if (e.response) {
        // API responded with error status
        errorMessage = `⚠️ MyAnimeList API error: ${e.response.status}`;
        logger.warn("API error response:", { status: e.response.status, data: e.response.data });
      } else if (e.request) {
        // No response received
        errorMessage = "⚠️ Could not connect to MyAnimeList. Please try again later.";
        logger.warn("No response from API:", { error: e.message });
      }
      
      try {
        await interaction.editReply({
          content: errorMessage,
          ephemeral: true
        });
      } catch (replyError) {
        logger.error("Failed to send error reply:", { error: replyError });
      }
    }
  }
};
