const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

/**
 * Module for the /imdb command.
 * This command searches for a movie or TV show on IMDB using the OMDb API.
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
      logger.debug(`/imdb command received from ${interaction.user.tag}`);
      
      // Retrieve and log the user's title input.
      const titleQuery = interaction.options.getString('title');
      logger.debug(`User input for title: '${titleQuery}'`);
      
      // Trim any extra whitespace from the title.
      const formattedTitle = titleQuery.trim();
      logger.debug(`Formatted title: '${formattedTitle}'`);
      
      // Construct the OMDb API request URL with query parameters.
      const searchUrl = "http://www.omdbapi.com/";
      const params = new URLSearchParams({
        t: formattedTitle,
        apikey: config.omdbApiKey
      });
      logger.debug(`Making OMDb API request to: ${searchUrl}?${params.toString()}`);
      
      // Fetch data from the OMDb API.
      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`OMDb API Response Status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        logger.debug(`Received IMDb data: ${JSON.stringify(data, null, 2)}`);
        
        // Check if the API response indicates success.
        if (data.Response === "True") {
          // Extract data from the API response.
          const movieTitle = data.Title || "Unknown";
          const year = data.Year || "Unknown";
          const genre = data.Genre || "Unknown";
          const imdbRating = data.imdbRating || "N/A";
          const plot = data.Plot || "No plot available.";
          // Use the poster if available and valid.
          const poster = data.Poster && data.Poster !== "N/A" ? data.Poster : null;
          const imdbId = data.imdbID || null;
          const imdbLink = imdbId ? `https://www.imdb.com/title/${imdbId}` : "N/A";
          
          logger.debug(`Extracted IMDb Data - Title: ${movieTitle}, Year: ${year}, Genre: ${genre}, IMDb Rating: ${imdbRating}`);
          
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
          
          // If a valid poster URL is available, set it as the thumbnail.
          if (poster) {
            embed.setThumbnail(poster);
          }
          
          // Edit the deferred reply with the embed.
          await interaction.editReply({ embeds: [embed] });
        } else {
          // Inform the user if no results were found.
          logger.warn(`No results found for title: '${formattedTitle}'`);
          await interaction.editReply(`❌ No results found for **${formattedTitle}**. Try another title!`);
        }
      } else {
        // Log and inform the user if the OMDb API returned an error status.
        logger.warn(`OMDb API error: ${response.status}`);
        await interaction.editReply(`⚠️ Error: OMDb API returned status code ${response.status}.`);
      }
    } catch (error) {
      // Log any unexpected errors and inform the user.
      logger.error(`Error in /imdb command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
