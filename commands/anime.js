/**
 * Anime command module for MyAnimeList integration.
 * Handles anime searches, data retrieval, and result formatting.
 * @module commands/anime
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

const MAL_API_BASE_URL = 'https://api.myanimelist.net/v2';
const MAL_WEBSITE_URL = 'https://myanimelist.net/anime';
const MAL_EMBED_COLOR = 0x2E51A2;
const SEARCH_LIMIT = 1;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anime')
    .setDescription('Search for anime on MyAnimeList and display detailed information.')
    .addStringOption(option =>
      option.setName('title')
        .setDescription('What anime do you want to search for?')
        .setRequired(true)
    ),
  
  /**
   * Executes the anime search command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If API request fails or configuration is missing
   */
  async execute(interaction) {
    try {
      if (!config.malClientId) {
        logger.error("MyAnimeList API client ID is not configured.");
        await interaction.reply({
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply();
      
      logger.info("Anime search requested:", { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag 
      });

      const titleQuery = interaction.options.getString('title');
      logger.debug("Processing search query:", { titleQuery });
      const formattedTitle = titleQuery.trim();

      const animeData = await this.searchAndGetAnimeDetails(formattedTitle);
      
      if (animeData) {
        const embed = this.createAnimeEmbed(animeData);
        await interaction.editReply({ embeds: [embed] });
        
        logger.info("Anime information sent successfully:", { 
          animeTitle: animeData.title, 
          userId: interaction.user.id 
        });
      } else {
        logger.info("No anime results found for query:", { query: formattedTitle });
        await interaction.editReply({
          content: ERROR_MESSAGES.NO_RESULTS_FOUND
        });
      }
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Searches for anime and retrieves detailed information.
   * @async
   * @function searchAndGetAnimeDetails
   * @param {string} title - The anime title to search for
   * @returns {Promise<Object|null>} Anime details or null if not found
   * @throws {Error} If API request fails
   */
  async searchAndGetAnimeDetails(title) {
    const headers = { "X-MAL-CLIENT-ID": config.malClientId };
    const searchUrl = `${MAL_API_BASE_URL}/anime?q=${encodeURIComponent(title)}&limit=${SEARCH_LIMIT}`;
    
    logger.debug("Making MAL search request:", { searchUrl });
    const searchResponse = await axios.get(searchUrl, { headers });
    
    if (searchResponse.status !== 200 || !searchResponse.data.data || !searchResponse.data.data.length) {
      logger.warn("No anime results found:", { title });
      return null;
    }
    
    const animeNode = searchResponse.data.data[0].node;
    const animeId = animeNode.id;
    
    const detailsUrl = `${MAL_API_BASE_URL}/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
    
    logger.debug("Fetching anime details:", { animeId });
    const detailsResponse = await axios.get(detailsUrl, { headers });
    
    if (detailsResponse.status !== 200) {
      logger.error("Failed to retrieve anime details:", { 
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
   * Creates an embed with anime information.
   * @function createAnimeEmbed
   * @param {Object} animeData - The anime data to display
   * @returns {EmbedBuilder} The formatted embed
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
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
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
      }).catch(() => {});
    }
  }
};