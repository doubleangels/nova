const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anime')
    .setDescription('Search for an anime on MyAnimeList.')
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Enter the anime title.')
        .setRequired(true)
    ),
  async execute(interaction) {
    try {
      await interaction.deferReply();
      logger.debug(`/anime command received from ${interaction.user.tag}`);
      
      const titleQuery = interaction.options.getString('title');
      logger.debug(`User input for title: '${titleQuery}'`);
      
      const formattedTitle = titleQuery.trim();
      logger.debug(`Formatted title: '${formattedTitle}'`);

      const searchUrl = `https://api.myanimelist.net/v2/anime?q=${encodeURIComponent(formattedTitle)}&limit=1`;
      const headers = { "X-MAL-CLIENT-ID": config.malClientId };
      logger.debug(`Making MyAnimeList API request to: ${searchUrl} with headers ${JSON.stringify(headers)}`);

      const searchResponse = await fetch(searchUrl, { headers });
      logger.debug(`MyAnimeList API (search) Response Status: ${searchResponse.status}`);

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        logger.debug(`Received MAL search data: ${JSON.stringify(searchData, null, 2)}`);

        if (searchData.data && searchData.data.length > 0) {
          const animeNode = searchData.data[0].node;
          const animeId = animeNode.id;
          const animeTitle = animeNode.title || "Unknown";
          const imageUrl = animeNode.main_picture ? animeNode.main_picture.medium : null;
          const malLink = animeId ? `https://myanimelist.net/anime/${animeId}` : "N/A";

          const detailsUrl = `https://api.myanimelist.net/v2/anime/${animeId}?fields=id,title,synopsis,mean,genres,start_date`;
          logger.debug(`Making MAL details request to: ${detailsUrl} with headers ${JSON.stringify(headers)}`);
          
          const detailsResponse = await fetch(detailsUrl, { headers });
          logger.debug(`MyAnimeList API (details) Response Status: ${detailsResponse.status}`);

          if (detailsResponse.ok) {
            const detailsData = await detailsResponse.json();
            const synopsis = detailsData.synopsis || "No synopsis available.";
            const rating = detailsData.mean || "N/A";
            const genresArray = detailsData.genres || [];
            const genres = genresArray.length > 0 ? genresArray.map(g => g.name).join(", ") : "Unknown";
            const releaseDate = detailsData.start_date || "Unknown";

            logger.debug(`Extracted MAL Data - Title: ${animeTitle}, Rating: ${rating}, Genres: ${genres}`);

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
            
            await interaction.editReply({ embeds: [embed] });
          } else {
            logger.warn(`Error fetching extra details from MAL: ${detailsResponse.status}`);
            await interaction.editReply("⚠️ Error fetching additional anime details. Please try again later.");
          }
        } else {
          logger.warn(`No results found for title: '${formattedTitle}'`);
          await interaction.editReply(`❌ No anime found for **${formattedTitle}**. Try another title!`);
        }
      } else {
        logger.warn(`MyAnimeList API error: ${searchResponse.status}`);
        await interaction.editReply(`⚠️ Error: MAL API returned status code ${searchResponse.status}.`);
      }
    } catch (e) {
      logger.error(`Error in /anime command: ${e}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
