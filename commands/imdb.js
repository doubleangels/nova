const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

// These are the configuration constants for the IMDb search command.
const OMDB_API_URL = 'https://www.omdbapi.com/';
const IMDB_BASE_URL = 'https://www.imdb.com/title/';
const EMBED_COLOR = 0xFFD700; // IMDb gold color for consistent branding
const REQUEST_TIMEOUT = 10000; // 10 second API request timeout to prevent hanging

/**
 * Module for the /imdb command.
 * This command searches for a movie or TV show on IMDb using the OMDb API and displays detailed information.
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
      // We validate that the API configuration is properly set up before proceeding.
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact a server administrator.",
          ephemeral: true
        });
      }
        
      // We defer the reply to allow time for the API request and processing.
      await interaction.deferReply();
      logger.info(`/imdb command initiated.`, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // We get and validate the search parameters provided by the user.
      const searchParams = this.getSearchParameters(interaction);
      if (!searchParams.valid) {
        return await interaction.editReply({
          content: searchParams.message,
          ephemeral: true
        });
      }
      
      // We fetch movie data from the OMDb API using the validated parameters.
      const movieData = await this.fetchMovieData(searchParams);
      
      if (movieData.error) {
        return await interaction.editReply({
          content: movieData.message,
          ephemeral: true
        });
      }
      
      // We create and send the embed with detailed movie information.
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
        content: "⚠️ An unexpected error occurred. Please try again later.",
        ephemeral: true
      });
    }
  },
  
  /**
   * Validates that the required API configuration is available.
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
    // We retrieve the user's inputs from the command options.
    const titleQuery = interaction.options.getString('title');
    const type = interaction.options.getString('type');
    const year = interaction.options.getString('year');
    
    // We trim any extra whitespace from the title and validate it's not empty.
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

    // We validate the year format if it was provided.
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
    // We construct the OMDb API request URL with all necessary query parameters.
    const params = new URLSearchParams({
      t: searchParams.title,
      apikey: config.omdbApiKey
    });
    
    // We add optional parameters if they were provided by the user.
    if (searchParams.type) {
      params.append('type', searchParams.type);
    }
    
    if (searchParams.year) {
      params.append('y', searchParams.year);
    }
    
    const requestUrl = `${OMDB_API_URL}?${params.toString()}`;
    
    // We fetch data from the OMDb API using axios with a timeout to prevent hanging.
    try {
      const response = await axios.get(requestUrl, { 
        timeout: REQUEST_TIMEOUT 
      });
      
      logger.debug("OMDb API response received.", {
        status: response.status
      });
      
      const data = response.data;
      
      // We check if the API response indicates success or failure.
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
   * Creates an embed with movie information for a visually appealing display.
   * @param {Object} data - The movie data from the OMDb API.
   * @returns {EmbedBuilder} The created embed with formatted movie information.
   */
  createMovieEmbed(data) {
    // We extract all relevant data from the API response.
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
    
    // We build the embed message with all movie details in an organized format.
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
    
    // We set the poster as thumbnail if available to enhance the visual appeal.
    if (poster) {
      embed.setThumbnail(poster);
    }
    
    return embed;
  }
};