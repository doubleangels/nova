const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

/**
 * Command module for searching movies and TV shows using IMDb data.
 * Provides detailed information including plot, ratings, and cast.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('imdb')
    .setDescription('Search for movies and TV shows using IMDb.')
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('What movie or TV show do you want to search for?')
        .setRequired(true)
    ),

  /**
   * Executes the IMDb search command.
   * This function:
   * 1. Validates API configuration
   * 2. Fetches movie/show data from OMDb API
   * 3. Creates and sends an embed with the results
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error during the search process
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      if (!config.omdbApiKey) {
        logger.error("OMDb API key is not configured in the application.");
        await interaction.reply({
          content: "⚠️ OMDb API key is not configured. Please contact an administrator.",
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply();
      
      logger.info("/imdb command initiated:", { 
        userId: interaction.user.id, 
        userTag: interaction.user.tag 
      });

      const titleQuery = interaction.options.getString('title');
      logger.debug("Processing search query:", { titleQuery });
      const formattedTitle = titleQuery.trim();

      const response = await axios.get(`http://www.omdbapi.com/`, {
        params: {
          apikey: config.omdbApiKey,
          t: formattedTitle,
          plot: 'full'
        },
        timeout: 5000
      });

      if (response.data.Error) {
        logger.warn("No results found for query:", { query: formattedTitle });
        await interaction.editReply({
          content: "⚠️ No results found for your search. Please try a different title."
        });
        return;
      }

      const movieData = response.data;
      const embed = this.createMovieEmbed(movieData);
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/imdb command completed successfully:", { 
        title: movieData.Title, 
        userId: interaction.user.id,
        imdbId: movieData.imdbID
      });

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Creates a Discord embed with movie/show information.
   * 
   * @param {Object} movieData - The movie/show data from OMDb API
   * @returns {EmbedBuilder} Discord embed with movie/show details
   */
  createMovieEmbed(movieData) {
    const embed = new EmbedBuilder()
      .setColor(0xF5C518)
      .setTitle(`🎬 ${movieData.Title}`)
      .setDescription(movieData.Plot || 'No plot available')
      .addFields(
        { name: '📅 Year', value: movieData.Year, inline: true },
        { name: '⭐ Rating', value: movieData.imdbRating || 'N/A', inline: true },
        { name: '🎭 Genre', value: movieData.Genre || 'N/A', inline: true },
        { name: '🎥 Director', value: movieData.Director || 'N/A', inline: true },
        { name: '👥 Actors', value: movieData.Actors || 'N/A', inline: true },
        { name: '🏆 Awards', value: movieData.Awards || 'N/A', inline: true }
      )
      .setFooter({ text: 'Powered by OMDb API' });

    if (movieData.Poster && movieData.Poster !== 'N/A') {
      embed.setThumbnail(movieData.Poster);
    }

    return embed;
  },

  /**
   * Handles errors that occur during command execution.
   * Logs the error and sends an appropriate error message to the user.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in imdb command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while searching IMDb.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to search IMDb. Please try again later.";
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = "⚠️ Rate limit exceeded. Please try again in a few minutes.";
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    } else if (error.message === "NO_RESULTS") {
      errorMessage = "⚠️ No results found for your search query.";
    } else if (error.message === "INVALID_QUERY") {
      errorMessage = "⚠️ Please provide a valid search query.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for imdb command:", {
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