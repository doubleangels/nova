const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wikipedia')
    .setDescription('Search Wikipedia for articles and return the top result.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('What topic do you want to search for?')
        .setRequired(true)
    ),
  async execute(interaction) {
    try {
      await interaction.deferReply();
      logger.debug(`/wikipedia command received from ${interaction.user.tag}`);
      
      const query = interaction.options.getString('query');
      logger.debug(`User input for query: '${query}'`);
      
      const formattedQuery = query.trim();
      logger.debug(`Formatted query: '${formattedQuery}'`);
      
      const searchUrl = "https://en.wikipedia.org/w/api.php";
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        list: "search",
        srsearch: formattedQuery,
        utf8: "1"
      });
      logger.debug(`Making Wikipedia API request to: ${searchUrl}?${params.toString()}`);
      
      const response = await fetch(`${searchUrl}?${params.toString()}`);
      logger.debug(`Wikipedia API Response Status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        logger.debug(`Received Wikipedia data: ${JSON.stringify(data, null, 2)}`);
        
        const searchResults = data.query && data.query.search;
        if (searchResults && searchResults.length > 0) {
          const topResult = searchResults[0];
          const title = topResult.title || "No Title";
          let snippet = topResult.snippet || "No snippet available.";
          snippet = snippet.replace(/<span class="searchmatch">/g, "**").replace(/<\/span>/g, "**");
          const pageId = topResult.pageid;
          const wikiUrl = `https://en.wikipedia.org/?curid=${pageId}`;
          logger.debug(`Extracted Wikipedia Data - Title: ${title}, Page ID: ${pageId}`);
          
          const embed = new EmbedBuilder()
            .setTitle(`📖 **${title}**`)
            .setDescription(`📜 **Summary:** ${snippet}`)
            .setURL(wikiUrl)
            .setColor(0xFFFFFF)
            .addFields({ name: "🔗 Wikipedia Link", value: `[Click Here](${wikiUrl})`, inline: false })
            .setFooter({ text: "Powered by Wikipedia API" });
          
          await interaction.editReply({ embeds: [embed] });
        } else {
          logger.warn(`No results found for query: '${formattedQuery}'`);
          await interaction.editReply(`❌ No results found for **${formattedQuery}**. Try refining your search!`);
        }
      } else {
        logger.warn(`Wikipedia API error: ${response.status}`);
        await interaction.editReply(`⚠️ Error: Wikipedia API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error(`Error in /wikipedia command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
