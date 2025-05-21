const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We define configuration constants for the MyAnimeList API integration.
const MAL_API_BASE_URL = 'https://api.myanimelist.net/v2';
const MAL_WEBSITE_URL = 'https://myanimelist.net/anime';
const MAL_EMBED_COLOR = 0x2E51A2;
const SEARCH_LIMIT = 1;

/**
 * We handle the anime command.
 * This function searches for anime on MyAnimeList and displays detailed information.
 *
 * We perform several tasks:
 * 1. We search for the anime on MyAnimeList.
 * 2. We fetch detailed information about the anime.
 * 3. We create an embed with the anime details.
 * 4. We send the embed to the user.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('anime')
    .setDescription('Search for anime on MyAnimeList and display detailed information.')
    .addStringOption(option =>
      option.setName('title')
        .setDescription('What anime do you want to search for?')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    try {
      // We verify that the API key is properly configured before proceeding.
      if (!config.malClientId) {
        logger.error("MyAnimeList API client ID is not configured.");
        await interaction.reply({
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
        return;
      }

      // We defer the reply to allow additional processing time for the API request.
      await interaction.deferReply();
      
      logger.info("Anime search requested.", { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag 
      });

      // We retrieve and format the anime title from the user's input.
      const titleQuery = interaction.options.getString('title');
      logger.debug("Processing search query.", { titleQuery });
      const formattedTitle = titleQuery.trim();

      // We search for the anime and get its details from the API.
      const animeData = await this.searchAndGetAnimeDetails(formattedTitle);
      
      // We create and send the embed with the anime information.
      if (animeData) {
        const embed = this.createAnimeEmbed(animeData);
        await interaction.editReply({ embeds: [embed] });
        
        logger.info("Anime information sent successfully.", { 
          animeTitle: animeData.title, 
          userId: interaction.user.id 
        });
      } else {
        logger.info("No anime results found for query.", { query: formattedTitle });
        await interaction.editReply({
          content: ERROR_MESSAGES.NO_RESULTS_FOUND
        });
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * We search for an anime and get its details from the MyAnimeList API.
   * This function performs both the search and detailed information retrieval.
   *
   * @param {string} title - The anime title to search for.
   * @returns {Object|null} The anime data or null if not found.
   */
  async searchAndGetAnimeDetails(title) {
    const headers = { "X-MAL-CLIENT-ID": config.malClientId };
    const searchUrl = `${MAL_API_BASE_URL}/anime?q=${encodeURIComponent(title)}&limit=${SEARCH_LIMIT}`;
    
    logger.debug("Making MAL search request.", { searchUrl });
    const searchResponse = await axios.get(searchUrl, { headers });
    
    if (searchResponse.status !== 200 || !searchResponse.data.data || !searchResponse.data.data.length) {
      logger.warn("No anime results found.", { title });
      return null;
    }
    
    const animeNode = searchResponse.data.data[0].node;
    const animeId = animeNode.id;
    
    // We construct the URL for fetching detailed information about the anime.
    const detailsUrl = `${MAL_API_BASE_URL}/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
    
    // We request detailed anime information from the API.
    logger.debug("Fetching anime details.", { animeId });
    const detailsResponse = await axios.get(detailsUrl, { headers });
    
    if (detailsResponse.status !== 200) {
      logger.error("Failed to retrieve anime details.", { 
        status: detailsResponse.status,
        animeId
      });
      throw new Error("API_ERROR");
    }
    
    const detailsData = detailsResponse.data;
    return {
      id: animeId,
      title: detailsData.title || "Unknown",
      synopsis: detailsData.synopsis || "No synopsis available.",
      rating: detailsData.mean || "N/A",
      genres: detailsData.genres || [],
      releaseDate: detailsData.start_date || null,
      imageUrl: animeNode.main_picture ? animeNode.main_picture.medium : null
    };
  },

  /**
   * We create an embed for displaying anime details in a visually appealing format.
   * This function formats all the anime information into a Discord embed.
   *
   * @param {Object} animeData - The anime data to display.
   * @returns {EmbedBuilder} The created embed with formatted anime information.
   */
  createAnimeEmbed(animeData) {
    const malLink = `${MAL_WEBSITE_URL}/${animeData.id}`;
    const genres = animeData.genres.length > 0 
      ? animeData.genres.map(g => g.name).join(", ") 
      : "Unknown";
    const releaseDate = animeData.releaseDate 
      ? dayjs(animeData.releaseDate).format('YYYY') 
      : "Unknown";
    
    const embed = new EmbedBuilder()
      .setTitle(`📺 **${animeData.title} (${releaseDate})**`)
      .setDescription(`📜 **Synopsis:** ${animeData.synopsis}`)
      .setColor(MAL_EMBED_COLOR)
      .addFields(
        { name: "🎭 Genre", value: `🎞 ${genres}`, inline: true },
        { name: "⭐ MAL Rating", value: `🌟 ${animeData.rating}`, inline: true },
        { name: "🔗 MAL Link", value: `[Click Here](${malLink})`, inline: false }
      )
      .setFooter({ text: "Powered by MyAnimeList API" });
    
    if (animeData.imageUrl) {
      embed.setThumbnail(animeData.imageUrl);
    }
    
    return embed;
  },

  /**
   * We handle errors that occur during the anime command execution.
   * This function provides appropriate error messages and logging.
   *
   * @param {Interaction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'anime', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.ANIME_API_ERROR;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = ERROR_MESSAGES.API_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.API_NETWORK_ERROR;
    } else if (error.message === "NO_RESULTS") {
      errorMessage = ERROR_MESSAGES.ANIME_NO_RESULTS;
    } else if (error.message === "INVALID_TITLE") {
      errorMessage = ERROR_MESSAGES.ANIME_INVALID_TITLE;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for anime command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // We silently catch if all error handling attempts fail.
      });
    }
  }
};