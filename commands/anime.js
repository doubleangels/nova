const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');

// Configuration constants.
const MAL_API_BASE_URL = 'https://api.myanimelist.net/v2';
const MAL_WEBSITE_URL = 'https://myanimelist.net/anime';
const MAL_EMBED_COLOR = 0x2E51A2;
const SEARCH_LIMIT = 1;

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
      // Verify API key is configured.
      if (!config.malClientId) {
        logger.error("MyAnimeList API client ID is not configured.");
        await interaction.reply({
          content: "⚠️ Bot configuration error: MAL API key not set.",
          ephemeral: true
        });
        return;
      }

      // Defer reply to allow additional processing time.
      await interaction.deferReply();
      logger.info("Anime search requested.", { user: interaction.user.tag });

      // Retrieve and format the anime title.
      const titleQuery = interaction.options.getString('title');
      logger.debug("Processing search query.", { titleQuery });
      const formattedTitle = titleQuery.trim();

      // Prepare request components.
      const searchUrl = `${MAL_API_BASE_URL}/anime?q=${encodeURIComponent(formattedTitle)}&limit=${SEARCH_LIMIT}`;
      const headers = { "X-MAL-CLIENT-ID": config.malClientId };
      
      // Perform the search request using axios.
      logger.debug("Making MAL search request.", { searchUrl });
      const searchResponse = await axios.get(searchUrl, { headers });
      
      if (searchResponse.status === 200) {
        const searchData = searchResponse.data;
        
        // Check for results.
        if (searchData.data && searchData.data.length > 0) {
          const animeNode = searchData.data[0].node;
          const animeId = animeNode.id;
          const animeTitle = animeNode.title || "Unknown";
          const imageUrl = animeNode.main_picture ? animeNode.main_picture.medium : null;
          const malLink = animeId ? `${MAL_WEBSITE_URL}/${animeId}` : "N/A";

          // Construct the details URL.
          const detailsUrl = `${MAL_API_BASE_URL}/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
          
          // Request detailed anime information.
          logger.debug("Fetching anime details.", { animeId });
          const detailsResponse = await axios.get(detailsUrl, { headers });
          
          if (detailsResponse.status === 200) {
            const detailsData = detailsResponse.data;
            const synopsis = detailsData.synopsis || "No synopsis available.";
            const rating = detailsData.mean || "N/A";
            const genresArray = detailsData.genres || [];
            const genres = genresArray.length > 0 ? genresArray.map(g => g.name).join(", ") : "Unknown";
            const releaseDate = detailsData.start_date ? dayjs(detailsData.start_date).format('YYYY') : "Unknown";
            
            logger.debug("Retrieved anime details successfully.", { animeTitle });

            // Create an embed for the anime details.
            const embed = new EmbedBuilder()
              .setTitle(`📺 **${animeTitle} (${releaseDate})**`)
              .setDescription(`📜 **Synopsis:** ${synopsis}`)
              .setColor(MAL_EMBED_COLOR)
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
            logger.info("Anime information sent successfully.", { animeTitle, userId: interaction.user.id });
          } else {
            logger.warn("Failed to retrieve anime details.", { status: detailsResponse.status, animeId });
            await interaction.editReply({
              content: "⚠️ Error fetching additional anime details. Please try again later.",
              ephemeral: true
            });
          }
        } else {
          logger.info("No anime results found for query.", { query: formattedTitle });
          await interaction.editReply({
            content: `⚠️ No anime found for **${formattedTitle}**. Try another title!`,
            ephemeral: true
          });
        }
      } else {
        logger.warn("MAL API search returned an error status.", { status: searchResponse.status });
        await interaction.editReply({
          content: `⚠️ Error: MAL API returned status code ${searchResponse.status}.`,
          ephemeral: true
        });
      }
    } catch (error) {
      logger.error("Error executing anime command.", { 
        error: error.message, 
        stack: error.stack 
      });
      
      // Determine if the interaction can still be replied to.
      if (interaction.deferred) {
        await interaction.editReply({
          content: "⚠️ An unexpected error occurred. Please try again later.",
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: "⚠️ An unexpected error occurred. Please try again later.",
          ephemeral: true
        });
      }
    }
  }
};
