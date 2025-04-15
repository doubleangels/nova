const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

// Configuration constants
const OMDB_API_URL = 'https://www.omdbapi.com/';
const IMDB_BASE_URL = 'https://www.imdb.com/title/';
const EMBED_COLOR = 0xFFD700; // IMDb gold color
const REQUEST_TIMEOUT = 10000; // 10 second API request timeout

/**
 * Module for the /imdb command.
 * Searches for a movie or TV show on IMDB using the OMDb API.
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
   * Executes the /imdb command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Validate API configuration before proceeding.
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact a server administrator."
        });
      }
        
      // Defer the reply to allow time for processing.
      await interaction.deferReply();
      logger.info(`/imdb command initiated.`, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Get and validate search parameters
      const searchParams = this.getSearchParameters(interaction);
      if (!searchParams.valid) {
        return await interaction.editReply({
          content: searchParams.message
        });
      }
      
      // Fetch movie data from the API
      const movieData = await this.fetchMovieData(searchParams);
      
      if (movieData.error) {
        return await interaction.editReply({
          content: movieData.message
        });
      }
      
      // Create and send the embed with movie information
      const embed = this.createMovieEmbed(movieData);
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      logger.error("Error executing /imdb command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      await interaction.editReply({ 
        content: "⚠️ An unexpected error occurred. Please try again later."
      });
    }
  },
  
  /**
   * Validates that the required configuration is available.
   * @returns {boolean} True if configuration is valid, false otherwise.
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
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @returns {Object} An object with search parameters or error information.
   */
  getSearchParameters(interaction) {
    // Retrieve the user's inputs
    const titleQuery = interaction.options.getString('title');
    const type = interaction.options.getString('type');
    const year = interaction.options.getString('year');
    
    // Trim any extra whitespace from the title and validate
    const formattedTitle = titleQuery?.trim();
    if (!formattedTitle) {
      logger.warn("Empty title provided after trimming.", {
        userId: interaction.user.id,
        originalQuery: titleQuery
      });
      return {
        valid: false,
        message: "⚠️ Please provide a valid movie or show title."
      };
    }

    // Validate year if provided
    if (year && !/^\d{4}$/.test(year)) {
      logger.warn("Invalid year format provided.", {
        userId: interaction.user.id,
        year
      });
      return {
        valid: false,
        message: "⚠️ Year must be in the format YYYY (e.g., 2021)."
      };
    }
    
    logger.debug("Search parameters validated.", {
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
   * @param {Object} searchParams - The search parameters.
   * @returns {Object} The movie data or error information.
   */
  async fetchMovieData(searchParams) {
    // Construct the OMDb API request URL with query parameters
    const params = new URLSearchParams({
      t: searchParams.title,
      apikey: config.omdbApiKey
    });
    
    // Add optional parameters if provided
    if (searchParams.type) {
      params.append('type', searchParams.type);
    }
    
    if (searchParams.year) {
      params.append('y', searchParams.year);
    }
    
    const requestUrl = `${OMDB_API_URL}?${params.toString()}`;
    
    // Fetch data from the OMDb API using axios
    try {
      const response = await axios.get(requestUrl, { 
        timeout: REQUEST_TIMEOUT 
      });
      
      logger.debug("OMDb API response received.", {
        status: response.status
      });
      
      const data = response.data;
      
      // Check if the API response indicates success
      if (data.Response === "True") {
        logger.info("Media information retrieved successfully.", {
          title: data.Title,
          year: data.Year,
          imdbId: data.imdbID
        });
        return data;
      } else {
        const errorMessage = data.Error || "No results found";
        logger.warn("No results found for title.", {
          title: searchParams.title,
          errorMessage
        });
        return {
          error: true,
          message: `⚠️ ${errorMessage} for **${searchParams.title}**. Try another title or adjust your search parameters!`
        };
      }
    } catch (apiError) {
      logger.error("OMDb API request failed.", {
        error: apiError.message,
        status: apiError.response?.status,
        title: searchParams.title
      });
      
      const statusCode = apiError.response?.status || "unknown";
      const errorMessage = apiError.response?.data?.Error || apiError.message;
      return {
        error: true,
        message: `⚠️ OMDb API error (${statusCode}): ${errorMessage}`
      };
    }
  },
  
  /**
   * Creates an embed with movie information.
   * @param {Object} data - The movie data from the OMDb API.
   * @returns {EmbedBuilder} The created embed.
   */
  createMovieEmbed(data) {
    // Extract data from the API response
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
    
    // Build the embed message with movie details
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
    
    // Set the poster as thumbnail if available
    if (poster) {
      embed.setThumbnail(poster);
    }
    
    return embed;
  }
};