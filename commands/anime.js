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

const ANIME_API_BASE_URL = 'https://api.myanimelist.net/v2';
const ANIME_EMBED_COLOR = 0x2E51A2;
const ANIME_EMBED_FOOTER = "Powered by MyAnimeList API";
const ANIME_SEARCH_LIMIT = 1;
const ANIME_WEBSITE_URL = 'https://myanimelist.net/anime';

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
          content: "⚠️ MyAnimeList API client ID is not configured. Please contact an administrator.",
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply();
      
      logger.info("/anime command initiated:", { 
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
          content: "⚠️ No anime found matching your search. Please try a different title."
        });
      }
    } catch (error) {
      logger.error("Error in anime command:", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });

      let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";
      
      if (error.message === "API_ERROR") {
        errorMessage = "⚠️ Failed to communicate with MyAnimeList API. Please try again later.";
      } else if (error.message === "API_RATE_LIMIT") {
        errorMessage = "⚠️ MyAnimeList API rate limit reached. Please try again in a few moments.";
      } else if (error.message === "API_NETWORK_ERROR") {
        errorMessage = "⚠️ Network error: Could not connect to MyAnimeList. Please check your internet connection.";
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
    const searchUrl = `${ANIME_API_BASE_URL}/anime?q=${encodeURIComponent(title)}&limit=${ANIME_SEARCH_LIMIT}`;
    
    logger.debug("Making MAL search request:", { searchUrl });
    const searchResponse = await axios.get(searchUrl, { headers });
    
    if (searchResponse.status !== 200 || !searchResponse.data.data || !searchResponse.data.data.length) {
      logger.warn("No anime results found:", { title });
      return null;
    }
    
    const animeNode = searchResponse.data.data[0].node;
    const animeId = animeNode.id;
    
    const detailsUrl = `${ANIME_API_BASE_URL}/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
    
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
    const malLink = `${ANIME_WEBSITE_URL}/${animeData.id}`;
    const genres = animeData.genres.length > 0 
      ? animeData.genres.map(g => g.name).join(", ") 
      : "Unknown";
    const releaseDate = animeData.releaseDate 
      ? dayjs(animeData.releaseDate).format('YYYY') 
      : "Unknown";
    
    const embed = new EmbedBuilder()
      .setTitle(`📺 **${animeData.title} (${releaseDate})**`)
      .setDescription(`📜 **Synopsis:** ${animeData.synopsis}`)
      .setColor(ANIME_EMBED_COLOR)
      .addFields(
        { name: "🎭 Genre", value: `🎞 ${genres}`, inline: true },
        { name: "⭐ MAL Rating", value: `🌟 ${animeData.rating}`, inline: true },
        { name: "🔗 MAL Link", value: `[Click Here](${malLink})`, inline: false }
      )
      .setFooter({ text: ANIME_EMBED_FOOTER });
    
    if (animeData.imageUrl) {
      embed.setThumbnail(animeData.imageUrl);
    }
    
    return embed;
  }
};