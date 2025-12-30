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
    .addSubcommand(sub =>
      sub.setName('movie')
        .setDescription('Search for a movie on IMDb.')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('What movie do you want to search for?')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('tv')
        .setDescription('Search for a TV show on IMDb.')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('What TV show do you want to search for?')
            .setRequired(true)
        )
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
      const subcommand = interaction.options.getSubcommand();
      const titleQuery = interaction.options.getString('title');
      logger.info(`/imdb ${subcommand} command initiated:`, {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        subcommand
      });
      const formattedTitle = titleQuery.trim();
      let typeParam = undefined;
      let typeLabel = '';
      if (subcommand === 'movie') {
        typeParam = 'movie';
        typeLabel = 'Movie';
      } else if (subcommand === 'tv') {
        typeParam = 'series';
        typeLabel = 'TV Show';
      }
      const response = await axios.get(`http://www.omdbapi.com/`, {
        params: {
          apikey: config.omdbApiKey,
          t: formattedTitle,
          plot: 'full',
          type: typeParam
        },
        timeout: 5000
      });
      if (response.data.Error) {
        logger.warn("No results found for query:", { query: formattedTitle, type: typeParam });
        await interaction.editReply({
          content: `⚠️ No results found for your search. Please try a different title.`,
          ephemeral: true
        });
        return;
      }
      const data = response.data;
      const embed = this.createMediaEmbed(data, typeLabel);
      await interaction.editReply({ embeds: [embed] });
      logger.info(`/imdb ${subcommand} command completed successfully:`, {
        title: data.Title,
        userId: interaction.user.id,
        imdbId: data.imdbID,
        type: typeParam
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Creates a Discord embed with movie/show information.
   * @param {Object} data - The movie/show data from OMDb API
   * @param {string} typeLabel - 'Movie' or 'TV Show'
   * @returns {EmbedBuilder} Discord embed with details
   */
  createMediaEmbed(data, typeLabel) {
    const imdbUrl = data.imdbID ? `https://www.imdb.com/title/${data.imdbID}/` : null;
    const fields = [
      { name: '📅 Year', value: data.Year, inline: true },
      { name: '⭐ Rating', value: data.imdbRating || 'N/A', inline: true },
      { name: '🎭 Genre', value: data.Genre || 'N/A', inline: true },
      { name: '🎥 Director', value: data.Director || 'N/A', inline: true },
      { name: '👥 Actors', value: data.Actors || 'N/A', inline: true },
      { name: '🏆 Awards', value: data.Awards || 'N/A', inline: true },
      imdbUrl ? { name: '🔗 IMDb', value: `[View on IMDb](${imdbUrl})`, inline: false } : null
    ].filter(field => field !== null);
    
    const embed = new EmbedBuilder()
      .setColor(0xF5C518)
      .setTitle(`${typeLabel === 'Movie' ? '🎬' : '📺'} ${data.Title}`)
      .setDescription(data.Plot || 'No plot available')
      .addFields(fields)
      .setFooter({ text: `Powered by OMDb API` });
    if (imdbUrl) embed.setURL(imdbUrl);
    if (data.Poster && data.Poster !== 'N/A') {
      embed.setThumbnail(data.Poster);
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