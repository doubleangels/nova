const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');

/**
 * @typedef {Object} AnimeData
 * @property {number} id - MyAnimeList anime ID
 * @property {string} title - Anime title
 * @property {string} synopsis - Anime synopsis
 * @property {string|number} rating - MyAnimeList rating
 * @property {Array<{name: string}>} genres - Array of genre objects
 * @property {string|null} releaseDate - Release date string
 * @property {string|null} imageUrl - URL to anime thumbnail
 */

/**
 * Command module for searching and displaying anime information from MyAnimeList
 * @type {Object}
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
  
  /**
   * Executes the anime search command
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   * @throws {Error} If the command execution fails
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
        
        logger.info("/anime command completed successfully:", { 
          animeTitle: animeData.title, 
          userId: interaction.user.id 
        });
      } else {
        logger.info("No anime results found for query:", { query: formattedTitle });
        await interaction.editReply({
          content: "⚠️ No anime found matching your search. Please try a different title.",
          ephemeral: true
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
   * Searches for an anime and retrieves its details from MyAnimeList API
   * @param {string} title - The anime title to search for
   * @returns {Promise<AnimeData|null>} Anime data or null if not found
   * @throws {Error} If the API request fails
   */
  async searchAndGetAnimeDetails(title) {
    const headers = { "X-MAL-CLIENT-ID": config.malClientId };
    const searchUrl = `https://api.myanimelist.net/v2/anime?q=${encodeURIComponent(title)}&limit=1`;
    
    logger.debug("Making MAL search request:", { searchUrl });
    const searchResponse = await axios.get(searchUrl, { headers });
    
    if (searchResponse.status !== 200 || !searchResponse.data.data || !searchResponse.data.data.length) {
      logger.warn("No anime results found:", { title });
      return null;
    }
    
    const animeNode = searchResponse.data.data[0].node;
    const animeId = animeNode.id;
    
    const detailsUrl = `https://api.myanimelist.net/v2/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
    
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
   * Creates a Discord embed with anime information
   * @param {AnimeData} animeData - The anime data to display
   * @returns {EmbedBuilder} Discord embed with formatted anime information
   */
  createAnimeEmbed(animeData) {
    const malLink = `https://myanimelist.net/anime/${animeData.id}`;
    const genres = animeData.genres.length > 0 
      ? animeData.genres.map(g => g.name).join(", ") 
      : "Unknown";
    const releaseDate = this.formatReleaseDate(animeData.releaseDate);
    
    const embed = new EmbedBuilder()
      .setTitle(`📺 **${animeData.title}**`)
      .setDescription(`📜 **Synopsis:** ${animeData.synopsis}`)
      .setColor(0x2E51A2)
      .addFields(
        { name: "🎭 Genre", value: `🎞 ${genres}`, inline: true },
        { name: "⭐ MAL Rating", value: `🌟 ${animeData.rating}`, inline: true },
        { name: "📅 Release Date", value: releaseDate, inline: true },
        { name: "🔗 MAL Link", value: `[Click Here](${malLink})`, inline: false }
      )
      .setFooter({ text: "Powered by MyAnimeList API" });
    
    if (animeData.imageUrl) {
      embed.setThumbnail(animeData.imageUrl);
    }
    
    return embed;
  },

  /**
   * Formats a release date string to a readable date format
   * @param {string} releaseDate - The release date string from MyAnimeList API
   * @returns {string} Formatted date or year
   */
  formatReleaseDate(releaseDate) {
    if (!releaseDate || releaseDate === 'Unknown') {
      return 'Unknown';
    }
    
    try {
      // MyAnimeList API can return YYYY-MM-DD, YYYY-MM, or YYYY
      if (releaseDate.length === 4) {
        // Year only - just return the year
        return releaseDate;
      } else if (releaseDate.length === 7) {
        // Year-Month - format as "Month YYYY"
        const date = new Date(`${releaseDate}-01`);
        if (isNaN(date.getTime())) {
          return releaseDate;
        }
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      } else if (releaseDate.length === 10) {
        // Full date - format as readable date
        const date = new Date(releaseDate);
        if (isNaN(date.getTime())) {
          return releaseDate;
        }
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      } else {
        return releaseDate;
      }
    } catch (error) {
      return releaseDate;
    }
  }
};