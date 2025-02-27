const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

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
        .setDescription('Enter the anime title.')
        .setRequired(true)
    ),
  
  /**
   * Executes the /anime command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer reply to allow additional processing time.
      await interaction.deferReply();
      logger.debug("Received /anime command", { user: interaction.user.tag });

      // Retrieve and format the anime title.
      const titleQuery = interaction.options.getString('title');
      logger.debug("User input title", { titleQuery });
      const formattedTitle = titleQuery.trim();
      logger.debug("Formatted title", { formattedTitle });

      // Construct the search URL and headers.
      const searchUrl = `https://api.myanimelist.net/v2/anime?q=${encodeURIComponent(formattedTitle)}&limit=1`;
      const headers = { "X-MAL-CLIENT-ID": config.malClientId };
      logger.debug("Making MAL search request", { searchUrl, headers: { ...headers, "X-MAL-CLIENT-ID": "[REDACTED]" } });

      // Perform the search request.
      const searchResponse = await fetch(searchUrl, { headers });
      logger.debug("MAL search response", { status: searchResponse.status });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        logger.debug("Received MAL search data", { searchData });

        // Check for results.
        if (searchData.data && searchData.data.length > 0) {
          const animeNode = searchData.data[0].node;
          const animeId = animeNode.id;
          const animeTitle = animeNode.title || "Unknown";
          const imageUrl = animeNode.main_picture ? animeNode.main_picture.medium : null;
          const malLink = animeId ? `https://myanimelist.net/anime/${animeId}` : "N/A";

          // Construct the details URL.
          const detailsUrl = `https://api.myanimelist.net/v2/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
          logger.debug("Making MAL details request", { detailsUrl, headers: { ...headers, "X-MAL-CLIENT-ID": "[REDACTED]" } });

          // Request detailed anime information.
          const detailsResponse = await fetch(detailsUrl, { headers });
          logger.debug("MAL details response", { status: detailsResponse.status });

          if (detailsResponse.ok) {
            const detailsData = await detailsResponse.json();
            const synopsis = detailsData.synopsis || "No synopsis available.";
            const rating = detailsData.mean || "N/A";
            const genresArray = detailsData.genres || [];
            const genres = genresArray.length > 0 ? genresArray.map(g => g.name).join(", ") : "Unknown";
            const releaseDate = detailsData.start_date || "Unknown";
            
            logger.debug("Extracted anime details", { animeTitle, rating, genres, releaseDate });

            // Create an embed for the anime details.
            const embed = new EmbedBuilder()
              .setTitle(`📺 **${animeTitle} (${releaseDate})**`)
              .setDescription(`📜 **Synopsis:** ${synopsis}`)
              .setColor(0x2E51A2)
              .addFields(
                { name: "🎭 Genre", value: `🎞 ${genres}`, inline: true },
                { name: "⭐ MAL Rating", value: `🌟 ${rating}`, inline: true },
                { name: "🔗 MAL Link", value: `[Click Here](${malLink})`, inline: false }
              )
              .setFooter({ text: "Powered by MyAnimeList API" });
            
            if (imageUrl) {
              embed.setThumbnail(imageUrl);
            }
            
            // Send the embed back to the user.
            await interaction.editReply({ embeds: [embed] });
            logger.debug("Anime embed sent successfully", { animeTitle });
          } else {
            logger.warn("Error fetching MAL details", { detailsStatus: detailsResponse.status });
            await interaction.editReply("⚠️ Error fetching additional anime details. Please try again later.");
          }
        } else {
          logger.warn("No anime results found", { formattedTitle });
          await interaction.editReply(`❌ No anime found for **${formattedTitle}**. Try another title!`);
        }
      } else {
        logger.warn("MAL API search error", { status: searchResponse.status });
        await interaction.editReply(`⚠️ Error: MAL API returned status code ${searchResponse.status}.`);
      }
    } catch (e) {
      logger.error("Error in /anime command", { error: e });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
