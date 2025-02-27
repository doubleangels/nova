const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

/**
 * Module for the /anime command.
 * This command searches for an anime on MyAnimeList based on the provided title,
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
      // Defer the reply to give the bot more time to process the command.
      await interaction.deferReply();
      logger.debug(`/anime command received from ${interaction.user.tag}`);

      // Retrieve and log the user input for the anime title.
      const titleQuery = interaction.options.getString('title');
      logger.debug(`User input for title: '${titleQuery}'`);

      // Trim any extra whitespace from the title.
      const formattedTitle = titleQuery.trim();
      logger.debug(`Formatted title: '${formattedTitle}'`);

      // Construct the search URL for the MyAnimeList API.
      const searchUrl = `https://api.myanimelist.net/v2/anime?q=${encodeURIComponent(formattedTitle)}&limit=1`;
      // Setup the headers with the MAL client ID.
      const headers = { "X-MAL-CLIENT-ID": config.malClientId };
      logger.debug(`Making MyAnimeList API request to: ${searchUrl} with headers ${JSON.stringify(headers)}`);

      // Make the search request to the MyAnimeList API.
      const searchResponse = await fetch(searchUrl, { headers });
      logger.debug(`MyAnimeList API (search) Response Status: ${searchResponse.status}`);

      if (searchResponse.ok) {
        // Parse the JSON response from the search request.
        const searchData = await searchResponse.json();
        logger.debug(`Received MAL search data: ${JSON.stringify(searchData, null, 2)}`);

        // Check if there is at least one result.
        if (searchData.data && searchData.data.length > 0) {
          // Extract basic anime information from the first result.
          const animeNode = searchData.data[0].node;
          const animeId = animeNode.id;
          const animeTitle = animeNode.title || "Unknown";
          const imageUrl = animeNode.main_picture ? animeNode.main_picture.medium : null;
          const malLink = animeId ? `https://myanimelist.net/anime/${animeId}` : "N/A";

          // Construct the URL for fetching detailed anime information.
          const detailsUrl = `https://api.myanimelist.net/v2/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
          logger.debug(`Making MAL details request to: ${detailsUrl} with headers ${JSON.stringify(headers)}`);
          
          // Make the request for additional details.
          const detailsResponse = await fetch(detailsUrl, { headers });
          logger.debug(`MyAnimeList API (details) Response Status: ${detailsResponse.status}`);

          if (detailsResponse.ok) {
            // Parse the detailed data response.
            const detailsData = await detailsResponse.json();
            const synopsis = detailsData.synopsis || "No synopsis available.";
            const rating = detailsData.mean || "N/A";
            const genresArray = detailsData.genres || [];
            // Format the genres as a comma-separated string.
            const genres = genresArray.length > 0 ? genresArray.map(g => g.name).join(", ") : "Unknown";
            const releaseDate = detailsData.start_date || "Unknown";

            logger.debug(`Extracted MAL Data - Title: ${animeTitle}, Rating: ${rating}, Genres: ${genres}`);

            // Build the embed message to be sent back to the user.
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
            
            // Add a thumbnail if an image URL is available.
            if (imageUrl) {
              embed.setThumbnail(imageUrl);
            }
            
            // Edit the original reply with the constructed embed.
            await interaction.editReply({ embeds: [embed] });
          } else {
            // Log and inform the user if there was an error fetching detailed information.
            logger.warn(`Error fetching extra details from MAL: ${detailsResponse.status}`);
            await interaction.editReply("⚠️ Error fetching additional anime details. Please try again later.");
          }
        } else {
          // Log and inform the user if no anime results were found.
          logger.warn(`No results found for title: '${formattedTitle}'`);
          await interaction.editReply(`❌ No anime found for **${formattedTitle}**. Try another title!`);
        }
      } else {
        // Log and inform the user if the initial API call failed.
        logger.warn(`MyAnimeList API error: ${searchResponse.status}`);
        await interaction.editReply(`⚠️ Error: MAL API returned status code ${searchResponse.status}.`);
      }
    } catch (e) {
      // Log any unexpected errors and notify the user.
      logger.error(`Error in /anime command: ${e}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
