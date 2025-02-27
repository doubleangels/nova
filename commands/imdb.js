const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch').default;
const logger = require('../logger');
const config = require('../config');

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
  async execute(interaction) {
    try {
      await interaction.deferReply();
      logger.debug(`/imdb command received from ${interaction.user.tag}`);
      
      const titleQuery = interaction.options.getString('title');
      logger.debug(`User input for title: '${titleQuery}'`);
      
      const formattedTitle = titleQuery.trim();
      logger.debug(`Formatted title: '${formattedTitle}'`);
      
      const searchUrl = "http://www.omdbapi.com/";
      const params = new URLSearchParams({
        t: formattedTitle,
        apikey: config.omdbApiKey
      });
      logger.debug(`Making OMDb API request to: ${searchUrl}?${params.toString()}`);
      
      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`OMDb API Response Status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        logger.debug(`Received IMDb data: ${JSON.stringify(data, null, 2)}`);
        
        if (data.Response === "True") {
          const movieTitle = data.Title || "Unknown";
          const year = data.Year || "Unknown";
          const genre = data.Genre || "Unknown";
          const imdbRating = data.imdbRating || "N/A";
          const plot = data.Plot || "No plot available.";
          const poster = data.Poster && data.Poster !== "N/A" ? data.Poster : null;
          const imdbId = data.imdbID || null;
          const imdbLink = imdbId ? `https://www.imdb.com/title/${imdbId}` : "N/A";
          
          logger.debug(`Extracted IMDb Data - Title: ${movieTitle}, Year: ${year}, Genre: ${genre}, IMDb Rating: ${imdbRating}`);
          
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
          
          if (poster) {
            embed.setThumbnail(poster);
          }
          
          await interaction.editReply({ embeds: [embed] });
        } else {
          logger.warn(`No results found for title: '${formattedTitle}'`);
          await interaction.editReply(`❌ No results found for **${formattedTitle}**. Try another title!`);
        }
      } else {
        logger.warn(`OMDb API error: ${response.status}`);
        await interaction.editReply(`⚠️ Error: OMDb API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error(`Error in /imdb command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
