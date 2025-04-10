/**
 * Module for the /wikipedia command.
 * 
 * Searches Wikipedia for articles related to the provided query and returns the top result.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// Configuration constants.
const WIKIPEDIA_CONFIG = {
  COMMAND: {
    NAME: 'wikipedia',
    DESCRIPTION: 'Search Wikipedia for articles and return the top result.'
  },
  OPTIONS: {
    QUERY: {
      NAME: 'query',
      DESCRIPTION: 'What topic do you want to search for?'
    }
  },
  API: {
    BASE_URL: 'https://en.wikipedia.org/w/api.php',
    PARAMS: {
      ACTION: 'query',
      FORMAT: 'json',
      LIST: 'search',
      UTF8: '1'
    },
    ARTICLE_URL: 'https://en.wikipedia.org/?curid=%s'
  },
  EMBED: {
    COLOR: 0xFFFFFF,
    TITLE_PREFIX: '📖 **%s**',
    SUMMARY_PREFIX: '📜 **Summary:** %s',
    LINK_FIELD_NAME: '🔗 Wikipedia Link',
    LINK_FIELD_VALUE: '[Click Here](%s)',
    FOOTER: 'Powered by Wikipedia API'
  },
  RESPONSES: {
    NO_RESULTS: '⚠️ No results found for **%s**. Try refining your search!',
    API_ERROR: '⚠️ Error: Wikipedia API returned status code %s.',
    GENERAL_ERROR: '⚠️ An unexpected error occurred. Please try again later.'
  },
  FORMATTING: {
    SEARCH_MATCH_OPEN: '**',
    SEARCH_MATCH_CLOSE: '**',
    DEFAULT_TITLE: 'No Title',
    DEFAULT_SNIPPET: 'No snippet available.'
  },
  HTML_TAGS: {
    SEARCH_MATCH_OPEN: /<span class="searchmatch">/g,
    SEARCH_MATCH_CLOSE: /<\/span>/g
  }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName(WIKIPEDIA_CONFIG.COMMAND.NAME)
    .setDescription(WIKIPEDIA_CONFIG.COMMAND.DESCRIPTION)
    .addStringOption(option =>
      option
        .setName(WIKIPEDIA_CONFIG.OPTIONS.QUERY.NAME)
        .setDescription(WIKIPEDIA_CONFIG.OPTIONS.QUERY.DESCRIPTION)
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
      
      const query = interaction.options.getString(WIKIPEDIA_CONFIG.OPTIONS.QUERY.NAME);
      
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
        action: WIKIPEDIA_CONFIG.API.PARAMS.ACTION,
        format: WIKIPEDIA_CONFIG.API.PARAMS.FORMAT,
        list: WIKIPEDIA_CONFIG.API.PARAMS.LIST,
        srsearch: formattedQuery,
        utf8: WIKIPEDIA_CONFIG.API.PARAMS.UTF8
      });
      
      const requestUrl = `${WIKIPEDIA_CONFIG.API.BASE_URL}?${params.toString()}`;
      
      logger.debug("Making Wikipedia API request.", { 
        requestUrl 
      });
      
      // Make the API request using axios with a timeout.
      const response = await axios.get(requestUrl, { timeout: 5000 });
      
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
          const title = topResult.title || WIKIPEDIA_CONFIG.FORMATTING.DEFAULT_TITLE;
          
          // Replace HTML span tags with markdown for emphasis.
          let snippet = topResult.snippet || WIKIPEDIA_CONFIG.FORMATTING.DEFAULT_SNIPPET;
          snippet = snippet
            .replace(WIKIPEDIA_CONFIG.HTML_TAGS.SEARCH_MATCH_OPEN, WIKIPEDIA_CONFIG.FORMATTING.SEARCH_MATCH_OPEN)
            .replace(WIKIPEDIA_CONFIG.HTML_TAGS.SEARCH_MATCH_CLOSE, WIKIPEDIA_CONFIG.FORMATTING.SEARCH_MATCH_CLOSE);
          
          // Construct the Wikipedia page URL using the pageid.
          const pageId = topResult.pageid;
          const wikiUrl = WIKIPEDIA_CONFIG.API.ARTICLE_URL.replace('%s', pageId);
          
          logger.debug("Found Wikipedia article.", { 
            title, 
            pageId 
          });
          
          // Build an embed with the retrieved data.
          const embed = new EmbedBuilder()
            .setTitle(WIKIPEDIA_CONFIG.EMBED.TITLE_PREFIX.replace('%s', title))
            .setDescription(WIKIPEDIA_CONFIG.EMBED.SUMMARY_PREFIX.replace('%s', snippet))
            .setURL(wikiUrl)
            .setColor(WIKIPEDIA_CONFIG.EMBED.COLOR)
            .addFields({ 
              name: WIKIPEDIA_CONFIG.EMBED.LINK_FIELD_NAME, 
              value: WIKIPEDIA_CONFIG.EMBED.LINK_FIELD_VALUE.replace('%s', wikiUrl), 
              inline: false 
            })
            .setFooter({ 
              text: WIKIPEDIA_CONFIG.EMBED.FOOTER 
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
            content: WIKIPEDIA_CONFIG.RESPONSES.NO_RESULTS.replace('%s', formattedQuery), 
            ephemeral: true 
          });
        }
      } else {
        logger.warn("Wikipedia API returned non-200 status.", { 
          status: response.status,
          query: formattedQuery 
        });
        
        await interaction.editReply({ 
          content: WIKIPEDIA_CONFIG.RESPONSES.API_ERROR.replace('%s', response.status), 
          ephemeral: true 
        });
      }
    } catch (error) {
      logger.error("Error executing Wikipedia command.", { 
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        query: interaction.options?.getString(WIKIPEDIA_CONFIG.OPTIONS.QUERY.NAME) 
      });
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ 
          content: WIKIPEDIA_CONFIG.RESPONSES.GENERAL_ERROR, 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: WIKIPEDIA_CONFIG.RESPONSES.GENERAL_ERROR, 
          ephemeral: true 
        });
      }
    }
  }
};
