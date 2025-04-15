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
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
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
      logger.info("Anime search requested.", { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag 
      });

      // Retrieve and format the anime title.
      const titleQuery = interaction.options.getString('title');
      logger.debug("Processing search query.", { titleQuery });
      const formattedTitle = titleQuery.trim();

      // Search for anime and get details
      const animeData = await this.searchAndGetAnimeDetails(formattedTitle);
      
      // Create and send the embed
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
          content: `⚠️ No anime found for **${formattedTitle}**. Try another title!`
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
          content: `⚠️ Error: ${this.getErrorMessage(error)}`
        });
      } else {
        await interaction.reply({
          content: `⚠️ Error: ${this.getErrorMessage(error)}`,
          ephemeral: true
        });
      }
    }
  },

  /**
   * Searches for an anime and gets its details.
   * @param {string} title - The anime title to search for.
   * @returns {Object|null} - The anime data or null if not found.
   */
  async searchAndGetAnimeDetails(title) {
    const headers = { "X-MAL-CLIENT-ID": config.malClientId };
    const searchUrl = `${MAL_API_BASE_URL}/anime?q=${encodeURIComponent(title)}&limit=${SEARCH_LIMIT}`;
    
    logger.debug("Making MAL search request.", { searchUrl });
    const searchResponse = await axios.get(searchUrl, { headers });
    
    if (searchResponse.status !== 200 || !searchResponse.data.data || !searchResponse.data.data.length) {
      return null;
    }
    
    const animeNode = searchResponse.data.data[0].node;
    const animeId = animeNode.id;
    
    // Construct the details URL.
    const detailsUrl = `${MAL_API_BASE_URL}/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
    
    // Request detailed anime information.
    logger.debug("Fetching anime details.", { animeId });
    const detailsResponse = await axios.get(detailsUrl, { headers });
    
    if (detailsResponse.status !== 200) {
      throw new Error(`Failed to retrieve anime details. Status: ${detailsResponse.status}`);
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
   * Creates an embed for anime details.
   * @param {Object} animeData - The anime data.
   * @returns {EmbedBuilder} - The created embed.
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
   * Gets a user-friendly error message.
   * @param {Error} error - The error object.
   * @returns {string} - A user-friendly error message.
   */
  getErrorMessage(error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return `API error: ${error.response.status} - ${error.response.statusText}`;
      } else if (error.request) {
        return "Network error: Unable to reach MyAnimeList. Please try again later.";
      }
    }
    return "An unexpected error occurred. Please try again later.";
  }
};