const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch');
const config = require('../config');

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
        .setDescription('Enter the movie or TV show title.')
        .setRequired(true)
    ),
    
  /**
   * Executes the /imdb command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for processing.
      await interaction.deferReply();
      logger.debug("/imdb command received:", { user: interaction.user.tag });
      
      // Retrieve and log the user's title input.
      const titleQuery = interaction.options.getString('title');
      logger.debug("User input title:", { titleQuery });
      
      // Trim any extra whitespace from the title.
      const formattedTitle = titleQuery.trim();
      logger.debug("Formatted title:", { formattedTitle });
      
      // Construct the OMDb API request URL with query parameters.
      const searchUrl = "http://www.omdbapi.com/";
      const params = new URLSearchParams({
        t: formattedTitle,
        apikey: config.omdbApiKey
      });
      const requestUrl = `${searchUrl}?${params.toString()}`;
      logger.debug("Making OMDb API request:", { requestUrl });
      
      // Fetch data from the OMDb API using node-fetch.
      const response = await fetch(requestUrl);
      logger.debug("OMDb API response:", { status: response.status });
      
      if (response.ok) {
        const data = await response.json();
        logger.debug("Received IMDb data:", { data });
        
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
          const imdbLink = imdbId ? `https://www.imdb.com/title/${imdbId}` : "N/A";
          
          logger.debug("Extracted IMDb Data:", { movieTitle, year, genre, imdbRating });
          
          // Build the embed message with movie details.
          const embed = new EmbedBuilder()
            .setTitle(`🎬 **${movieTitle} (${year})**`)
            .setDescription(`📜 **Plot:** ${plot}`)
            .setColor(0xFFD700)
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
          logger.debug("IMDb embed sent successfully:", { movieTitle });
        } else {
          logger.warn("No results found for title:", { formattedTitle });
          await interaction.editReply(`❌ No results found for **${formattedTitle}**. Try another title!`);
        }
      } else {
        logger.warn("OMDb API error:", { status: response.status });
        await interaction.editReply(`⚠️ Error: OMDb API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error("Error in /imdb command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
