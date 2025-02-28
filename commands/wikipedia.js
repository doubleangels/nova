const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch');

/**
 * Module for the /wikipedia command.
 * Searches Wikipedia for articles related to the provided query and returns the top result.
 */
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
    
  /**
   * Executes the /wikipedia command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for the API call.
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      logger.debug("/wikipedia command received:", { user: interaction.user.tag, query });
      
      // Trim the query to remove unnecessary whitespace.
      const formattedQuery = query.trim();
      logger.debug("Formatted query:", { formattedQuery });
      
      // Build the Wikipedia API URL with query parameters.
      const searchUrl = "https://en.wikipedia.org/w/api.php";
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        list: "search",
        srsearch: formattedQuery,
        utf8: "1"
      });
      const requestUrl = `${searchUrl}?${params.toString()}`;
      logger.debug("Making Wikipedia API request:", { requestUrl });
      
      // Make the API request using node-fetch.
      const response = await fetch(requestUrl);
      logger.debug("Wikipedia API response:", { status: response.status });
      
      if (response.ok) {
        // Parse the JSON response.
        const data = await response.json();
        logger.debug("Received Wikipedia data:", { data });
        
        // Extract the search results.
        const searchResults = data.query && data.query.search;
        if (searchResults && searchResults.length > 0) {
          // Take the top result.
          const topResult = searchResults[0];
          const title = topResult.title || "No Title";
          // Replace HTML span tags with markdown for emphasis.
          let snippet = topResult.snippet || "No snippet available.";
          snippet = snippet.replace(/<span class="searchmatch">/g, "**").replace(/<\/span>/g, "**");
          // Construct the Wikipedia page URL using the pageid.
          const pageId = topResult.pageid;
          const wikiUrl = `https://en.wikipedia.org/?curid=${pageId}`;
          logger.debug("Extracted Wikipedia data:", { title, pageId });
          
          // Build an embed with the retrieved data.
          const embed = new EmbedBuilder()
            .setTitle(`📖 **${title}**`)
            .setDescription(`📜 **Summary:** ${snippet}`)
            .setURL(wikiUrl)
            .setColor(0xFFFFFF)
            .addFields({ name: "🔗 Wikipedia Link", value: `[Click Here](${wikiUrl})`, inline: false })
            .setFooter({ text: "Powered by Wikipedia API" });
          
          // Send the embed as the reply.
          await interaction.editReply({ embeds: [embed] });
          logger.debug("Wikipedia embed sent successfully:", { user: interaction.user.tag, title });
        } else {
          logger.warn("No results found:", { query: formattedQuery });
          await interaction.editReply(`❌ No results found for **${formattedQuery}**. Try refining your search!`);
        }
      } else {
        logger.warn("Wikipedia API error:", { status: response.status });
        await interaction.editReply(`⚠️ Error: Wikipedia API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error("Error in /wikipedia command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
