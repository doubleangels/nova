const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// Configuration constants.
const WIKIPEDIA_API_BASE_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_ARTICLE_URL = 'https://en.wikipedia.org/?curid=%s';
const WIKIPEDIA_EMBED_COLOR = 0xFFFFFF;
const WIKIPEDIA_SEARCH_MATCH_OPEN_REGEX = /<span class="searchmatch">/g;
const WIKIPEDIA_SEARCH_MATCH_CLOSE_REGEX = /<\/span>/g;
const WIKIPEDIA_API_TIMEOUT = 5000;

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
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for the API call.
      await interaction.deferReply();
      
      const query = interaction.options.getString('query');
      
      logger.debug("Wikipedia command received.", { 
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        query 
      });
      
      // Trim the query to remove unnecessary whitespace.
      const formattedQuery = query.trim();
      
      logger.debug("Processing Wikipedia search query.", { 
        formattedQuery 
      });
      
      // Build the Wikipedia API URL with query parameters.
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        list: 'search',
        srsearch: formattedQuery,
        utf8: '1'
      });
      
      const requestUrl = `${WIKIPEDIA_API_BASE_URL}?${params.toString()}`;
      
      logger.debug("Making Wikipedia API request.", { 
        requestUrl 
      });
      
      // Make the API request using axios with a timeout.
      const response = await axios.get(requestUrl, { timeout: WIKIPEDIA_API_TIMEOUT });
      
      logger.debug("Wikipedia API response received.", { 
        status: response.status 
      });
      
      if (response.status === 200) {
        // Parse the JSON response.
        const data = response.data;
        
        // Extract the search results.
        const searchResults = data.query && data.query.search;
        
        if (searchResults && searchResults.length > 0) {
          // Take the top result.
          const topResult = searchResults[0];
          const title = topResult.title || "No Title";
          
          // Replace HTML span tags with markdown for emphasis.
          let snippet = topResult.snippet || "No snippet available.";
          snippet = snippet
            .replace(WIKIPEDIA_SEARCH_MATCH_OPEN_REGEX, '**')
            .replace(WIKIPEDIA_SEARCH_MATCH_CLOSE_REGEX, '**');
          
          // Construct the Wikipedia page URL using the pageid.
          const pageId = topResult.pageid;
          const wikiUrl = WIKIPEDIA_ARTICLE_URL.replace('%s', pageId);
          
          logger.debug("Found Wikipedia article.", { 
            title, 
            pageId 
          });
          
          // Build an embed with the retrieved data.
          const embed = new EmbedBuilder()
            .setTitle(`📖 **${title}**`)
            .setDescription(`📜 **Summary:** ${snippet}`)
            .setURL(wikiUrl)
            .setColor(WIKIPEDIA_EMBED_COLOR)
            .addFields({ 
              name: '🔗 Wikipedia Link', 
              value: `[Click Here](${wikiUrl})`, 
              inline: false 
            })
            .setFooter({ 
              text: 'Powered by Wikipedia API' 
            });
          
          // Send the embed as the reply.
          await interaction.editReply({ embeds: [embed] });
          
          logger.info("Wikipedia search results sent successfully.", { 
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            query: formattedQuery,
            title
          });
        } else {
          logger.warn("No Wikipedia results found for query.", { 
            query: formattedQuery,
            userId: interaction.user.id
          });
          
          await interaction.editReply({ 
            content: `⚠️ No results found for **${formattedQuery}**. Try refining your search!`, 
            ephemeral: true 
          });
        }
      } else {
        logger.warn("Wikipedia API returned non-200 status.", { 
          status: response.status,
          query: formattedQuery 
        });
        
        await interaction.editReply({ 
          content: `⚠️ Error: Wikipedia API returned status code ${response.status}.`, 
          ephemeral: true 
        });
      }
    } catch (error) {
      logger.error("Error executing Wikipedia command.", { 
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        query: interaction.options?.getString('query') 
      });
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.', 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.', 
          ephemeral: true 
        });
      }
    }
  }
};
