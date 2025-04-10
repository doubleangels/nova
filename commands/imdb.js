const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'imdb',
  OMDB_API_URL: 'https://www.omdbapi.com/',
  IMDB_BASE_URL: 'https://www.imdb.com/title/',
  EMBED_COLOR: 0xFFD700, // IMDb gold color
  REQUEST_TIMEOUT: 10000 // 10 second API request timeout
};

/**
 * Module for the /imdb command.
 * Searches for a movie or TV show on IMDB using the OMDb API.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_CONFIG.NAME)
    .setDescription('Search for a movie or TV show on IMDB.')
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('What movie or TV show do you want to search for?')
        .setRequired(true)
    ),
    
  /**
   * Executes the /imdb command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Validate API configuration before proceeding.
      if (!config.omdbApiKey) {
        logger.error("OMDb API key is missing in configuration.", {
          userId: interaction.user.id,
          guildId: interaction.guildId
        });
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact a server administrator.",
          ephemeral: true
        });
      }

      // Defer the reply to allow time for processing.
      await interaction.deferReply();
      logger.info(`/${COMMAND_CONFIG.NAME} command initiated.`, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      // Retrieve the user's title input.
      const titleQuery = interaction.options.getString('title');
      
      // Trim any extra whitespace from the title and validate.
      const formattedTitle = titleQuery.trim();
      if (!formattedTitle) {
        logger.warn("Empty title provided after trimming.", {
          userId: interaction.user.id,
          originalQuery: titleQuery
        });
        return await interaction.editReply({
          content: "⚠️ Please provide a valid movie or show title.",
          ephemeral: true
        });
      }
      
      logger.debug("Processing search request.", {
        formattedTitle,
        userId: interaction.user.id
      });
      
      // Construct the OMDb API request URL with query parameters.
      const params = new URLSearchParams({
        t: formattedTitle,
        apikey: config.omdbApiKey
      });
      const requestUrl = `${COMMAND_CONFIG.OMDB_API_URL}?${params.toString()}`;
      
      // Fetch data from the OMDb API using axios.
      let response;
      try {
        response = await axios.get(requestUrl, { 
          timeout: COMMAND_CONFIG.REQUEST_TIMEOUT 
        });
        logger.debug("OMDb API response received.", {
          status: response.status
        });
      } catch (apiError) {
        logger.error("OMDb API request failed.", {
          error: apiError.message,
          status: apiError.response?.status,
          title: formattedTitle
        });
        
        const statusCode = apiError.response?.status || "unknown";
        const errorMessage = apiError.response?.data?.Error || apiError.message;
        return await interaction.editReply({
          content: `⚠️ OMDb API error (${statusCode}): ${errorMessage}`,
          ephemeral: true
        });
      }
      
      const data = response.data;
      
      // Check if the API response indicates success.
      if (data.Response === "True") {
        // Extract data from the API response.
        const movieTitle = data.Title || "Unknown";
        const year = data.Year || "Unknown";
        const genre = data.Genre || "Unknown";
        const imdbRating = data.imdbRating || "N/A";
        const plot = data.Plot || "No plot available.";
        const poster = (data.Poster && data.Poster !== "N/A") ? data.Poster : null;
        const imdbId = data.imdbID || null;
        const imdbLink = imdbId ? `${COMMAND_CONFIG.IMDB_BASE_URL}${imdbId}` : "N/A";
        
        logger.info("Media information retrieved successfully.", {
          title: movieTitle,
          year,
          imdbId,
          userId: interaction.user.id
        });
        
        // Build the embed message with movie details.
        const embed = new EmbedBuilder()
          .setTitle(`🎬 ${movieTitle} (${year})`)
          .setDescription(`📜 **Plot:** ${plot}`)
          .setColor(COMMAND_CONFIG.EMBED_COLOR)
          .addFields(
            { name: "🎭 Genre", value: `🎞 ${genre}`, inline: true },
            { name: "⭐ IMDb Rating", value: `🌟 ${imdbRating}`, inline: true },
            { name: "🔗 IMDb Link", value: `[Click Here](${imdbLink})`, inline: false }
          )
          .setFooter({ text: "Powered by OMDb API" });
        
        // Set the poster as thumbnail if available.
        if (poster) {
          embed.setThumbnail(poster);
        }
        
        // Edit the deferred reply with the embed.
        await interaction.editReply({ embeds: [embed] });
      } else {
        const errorMessage = data.Error || "No results found";
        logger.warn("No results found for title.", {
          title: formattedTitle,
          errorMessage,
          userId: interaction.user.id
        });
        await interaction.editReply({ 
          content: `⚠️ ${errorMessage} for **${formattedTitle}**. Try another title!`
        });
      }
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
  }
};
