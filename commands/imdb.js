/**
 * IMDb command module for searching and displaying movie and TV show information.
 * Handles API interactions with OMDb and result formatting.
 * @module commands/imdb
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { logError } = require('../errors');

const OMDB_API_URL = 'https://www.omdbapi.com/';
const IMDB_BASE_URL = 'https://www.imdb.com/title/';
const EMBED_COLOR = 0xFFD700;
const REQUEST_TIMEOUT = 10000;

/**
 * Error messages specific to the IMDb command.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    CONFIG_MISSING: "⚠️ This command is not properly configured. Please contact an administrator.",
    INVALID_INPUT: "⚠️ Please provide a valid title.",
    INVALID_YEAR_FORMAT: "⚠️ Year must be in the format YYYY (e.g., 2021).",
    NO_RESULTS_FOUND: "⚠️ No results found for your search.",
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while searching.",
    API_ERROR: "⚠️ Failed to fetch movie information. Please try again later.",
    API_RATE_LIMIT: "⚠️ API rate limit reached. Please try again in a few moments.",
    API_NETWORK_ERROR: "⚠️ Network error occurred. Please check your internet connection.",
    IMDB_API_ERROR: "⚠️ Failed to fetch movie information from OMDb. Please try again later.",
    IMDB_NO_RESULTS: "⚠️ No results found for your search.",
    REQUEST_TIMEOUT: "⚠️ The request timed out. Please try again later.",
    API_ACCESS_DENIED: "⚠️ API access denied. Please check API configuration.",
    RATE_LIMIT_EXCEEDED: "⚠️ Rate limit exceeded. Please try again later."
};

/**
 * We handle the imdb command.
 * This function allows users to search for movies and TV shows using the OMDb API.
 *
 * We perform several tasks:
 * 1. We validate OMDb API configuration.
 * 2. We process search requests for movies and TV shows.
 * 3. We format and display detailed media information.
 * 4. We handle errors and provide user feedback.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('imdb')
    .setDescription('Search for a movie or TV show on IMDB.')
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('What movie or TV show do you want to search for?')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('What type of media is it?')
        .setRequired(true)
        .addChoices(
          { name: 'Movie', value: 'movie' },
          { name: 'TV Show', value: 'series' },
          { name: 'Episode', value: 'episode' }
        )
    )
    .addStringOption(option =>
      option
        .setName('year')
        .setDescription('What year was it released? (e.g., 2021)')
        .setRequired(false)
    ),
    
  /**
   * Executes the IMDb search command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the API request fails
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
      }
        
      await interaction.deferReply();
      logger.info(`/imdb command initiated:`, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      const searchParams = this.getSearchParameters(interaction);
      if (!searchParams.valid) {
        return await interaction.editReply({
          content: searchParams.message,
          ephemeral: true
        });
      }
      
      const movieData = await this.fetchMovieData(searchParams);
      
      if (movieData.error) {
        return await interaction.editReply({
          content: movieData.message,
          ephemeral: true
        });
      }
      
      const embed = this.createMovieEmbed(movieData);
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Validates that the required API configuration is available.
   * @function validateConfiguration
   * @returns {boolean} True if configuration is valid, false otherwise
   */
  validateConfiguration() {
    if (!config.omdbApiKey) {
      logger.error("OMDb API key is missing in configuration.");
      return false;
    }
    return true;
  },
  
  /**
   * Gets and validates search parameters from the interaction.
   * @function getSearchParameters
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @returns {Object} Object with search parameters or error information
   */
  getSearchParameters(interaction) {
    const titleQuery = interaction.options.getString('title');
    const type = interaction.options.getString('type');
    const year = interaction.options.getString('year');
    
    const formattedTitle = titleQuery?.trim();
    if (!formattedTitle) {
      logger.warn("Empty title provided after trimming:", {
        userId: interaction.user.id,
        originalQuery: titleQuery
      });
      return {
        valid: false,
        message: ERROR_MESSAGES.INVALID_INPUT
      };
    }

    if (year && !/^\d{4}$/.test(year)) {
      logger.warn("Invalid year format provided:", {
        userId: interaction.user.id,
        year
      });
      return {
        valid: false,
        message: ERROR_MESSAGES.INVALID_YEAR_FORMAT
      };
    }
    
    logger.debug("Search parameters validated:", {
      title: formattedTitle,
      type,
      year,
      userId: interaction.user.id
    });
    
    return {
      valid: true,
      title: formattedTitle,
      type,
      year
    };
  },
  
  /**
   * Fetches movie data from the OMDb API.
   * @async
   * @function fetchMovieData
   * @param {Object} searchParams - The search parameters
   * @returns {Promise<Object>} The movie data or error information
   * @throws {Error} If the API request fails
   */
  async fetchMovieData(searchParams) {
    const params = new URLSearchParams({
      t: searchParams.title,
      apikey: config.omdbApiKey
    });
    
    if (searchParams.type) {
      params.append('type', searchParams.type);
    }
    
    if (searchParams.year) {
      params.append('y', searchParams.year);
    }
    
    const requestUrl = `${OMDB_API_URL}?${params.toString()}`;
    
    try {
      const response = await axios.get(requestUrl, { 
        timeout: REQUEST_TIMEOUT 
      });
      
      logger.debug("OMDb API response received:", {
        status: response.status
      });
      
      const data = response.data;
      
      if (data.Response === "True") {
        logger.info("Media information retrieved successfully:", {
          title: data.Title,
          year: data.Year,
          imdbId: data.imdbID
        });
        return data;
      } else {
        const errorMessage = data.Error || "No results found";
        logger.warn("No results found for title:", {
          title: searchParams.title,
          errorMessage
        });
        return {
          error: true,
          message: ERROR_MESSAGES.NO_RESULTS_FOUND
        };
      }
    } catch (apiError) {
      logger.error("OMDb API request failed:", {
        error: apiError.message,
        status: apiError.response?.status,
        title: searchParams.title
      });
      
      throw new Error("API_ERROR");
    }
  },
  
  /**
   * Creates an embed with movie information.
   * @function createMovieEmbed
   * @param {Object} data - The movie data from the OMDb API
   * @returns {import('discord.js').EmbedBuilder} The created embed
   */
  createMovieEmbed(data) {
    const movieTitle = data.Title || "Unknown";
    const year = data.Year || "Unknown";
    const genre = data.Genre || "Unknown";
    const imdbRating = data.imdbRating || "N/A";
    const plot = data.Plot || "No plot available.";
    const poster = (data.Poster && data.Poster !== "N/A") ? data.Poster : null;
    const imdbId = data.imdbID || null;
    const imdbLink = imdbId ? `${IMDB_BASE_URL}${imdbId}` : "N/A";
    const runtime = data.Runtime || "Unknown";
    const director = data.Director || "Unknown";
    const actors = data.Actors || "Unknown";
    
    const embed = new EmbedBuilder()
      .setTitle(`🎬 ${movieTitle} (${year})`)
      .setDescription(`📜 **Plot:** ${plot}`)
      .setColor(EMBED_COLOR)
      .addFields(
        { name: "🎭 Genre", value: `🎞 ${genre}`, inline: true },
        { name: "⭐ IMDb Rating", value: `🌟 ${imdbRating}`, inline: true },
        { name: "⏱️ Runtime", value: runtime, inline: true },
        { name: "🎬 Director", value: director, inline: true },
        { name: "🎭 Actors", value: actors, inline: false },
        { name: "🔗 IMDb Link", value: `[Click Here](${imdbLink})`, inline: false }
      )
      .setFooter({ text: "Powered by OMDb API" });
    
    if (poster) {
      embed.setThumbnail(poster);
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
    logError(error, 'imdb', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.IMDB_API_ERROR;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = ERROR_MESSAGES.API_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.API_NETWORK_ERROR;
    } else if (error.message === "NO_RESULTS") {
      errorMessage = ERROR_MESSAGES.IMDB_NO_RESULTS;
    } else if (error.message === "INVALID_TITLE") {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = ERROR_MESSAGES.REQUEST_TIMEOUT;
    } else if (error.response?.status === 403) {
      errorMessage = ERROR_MESSAGES.API_ACCESS_DENIED;
    } else if (error.response?.status === 429) {
      errorMessage = ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;
    } else if (error.response?.status >= 500) {
      errorMessage = ERROR_MESSAGES.API_ERROR;
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
      }).catch(() => {
      });
    }
  }
};