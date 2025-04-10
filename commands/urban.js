/**
 * Module for the /urban command.
 * 
 * This module allows users to search Urban Dictionary for definitions of specified terms.
 * It fetches data from the Urban Dictionary API and formats the results in an embed.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'urban',
  DESCRIPTION: 'Search Urban Dictionary for definitions.',
  OPTIONS: {
    QUERY: {
      NAME: 'query',
      DESCRIPTION: 'What term do you want to search for?'
    }
  },
  API: {
    URL: 'https://api.urbandictionary.com/v0/define'
  },
  EMBED: {
    COLOR: 0x1D2439,
    TITLE_PREFIX: '📖 Definition: ',
    EXAMPLE_FIELD: '📝 Example',
    THUMBS_UP_FIELD: '👍 Thumbs Up',
    THUMBS_DOWN_FIELD: '👎 Thumbs Down',
    FOOTER: '🔍 Powered by Urban Dictionary'
  },
  RESPONSES: {
    NO_DEFINITION: '⚠️ No definitions found for your query. Try refining it.',
    API_ERROR: '⚠️ Error: Urban Dictionary API returned status code %s.',
    GENERAL_ERROR: '⚠️ An unexpected error occurred. Please try again later.'
  },
  DEFAULTS: {
    NO_WORD: 'No Word',
    NO_DEFINITION: 'No Definition Available.',
    NO_EXAMPLE: 'No example available.'
  }
};

/**
 * Sanitizes text from the Urban Dictionary API for safe rendering.
 * 
 * @param {string} text - The text to sanitize.
 * @returns {string} - Sanitized text.
 */
function sanitizeText(text) {
  if (!text) return '';
  
  // Replace newlines and carriage returns for proper formatting
  return text.replace(/\r\n/g, '\n')
    // Truncate if extremely long (Discord has 4096 char limit for embed descriptions)
    .substring(0, 1000) 
    // Add ellipsis if truncated
    + (text.length > 1000 ? '...' : '');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_CONFIG.NAME)
    .setDescription(COMMAND_CONFIG.DESCRIPTION)
    .addStringOption(option =>
      option
        .setName(COMMAND_CONFIG.OPTIONS.QUERY.NAME)
        .setDescription(COMMAND_CONFIG.OPTIONS.QUERY.DESCRIPTION)
        .setRequired(true)
    ),
    
  /**
   * Executes the Urban Dictionary search command and returns the definition.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Get the query term from the interaction options.
      const query = interaction.options.getString(COMMAND_CONFIG.OPTIONS.QUERY.NAME);
      
      logger.info("Urban Dictionary search initiated.", {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        query: query,
        channelId: interaction.channelId,
        guildId: interaction.guildId
      });
      
      // Defer the reply to allow time for the API call.
      await interaction.deferReply();
      
      // Construct the Urban Dictionary API URL with query parameters.
      const params = new URLSearchParams({ term: query });
      const requestUrl = `${COMMAND_CONFIG.API.URL}?${params.toString()}`;
      
      logger.debug("Fetching data from Urban Dictionary API.", {
        query: query,
        requestUrl: requestUrl
      });
      
      // Fetch the definition data using axios.
      const response = await axios.get(requestUrl, { 
        timeout: 5000 // Add timeout for safety
      });
      
      // Process successful API response.
      if (response.status === 200) {
        const data = response.data;
        
        // Check if any definitions were returned.
        if (data.list && data.list.length > 0) {
          const topResult = data.list[0];
          const word = topResult.word || COMMAND_CONFIG.DEFAULTS.NO_WORD;
          const definition = sanitizeText(topResult.definition || COMMAND_CONFIG.DEFAULTS.NO_DEFINITION);
          const example = sanitizeText(topResult.example || COMMAND_CONFIG.DEFAULTS.NO_EXAMPLE);
          const thumbsUp = topResult.thumbs_up || 0;
          const thumbsDown = topResult.thumbs_down || 0;
          
          logger.debug("Definition found for query.", {
            query: query,
            word: word,
            definitionLength: definition.length,
            thumbsUp: thumbsUp,
            thumbsDown: thumbsDown
          });
          
          // Build an embed with the retrieved definition.
          const embed = new EmbedBuilder()
            .setTitle(`${COMMAND_CONFIG.EMBED.TITLE_PREFIX}${word}`)
            .setDescription(definition)
            .setColor(COMMAND_CONFIG.EMBED.COLOR)
            .addFields(
              { name: COMMAND_CONFIG.EMBED.EXAMPLE_FIELD, value: example, inline: false },
              { name: COMMAND_CONFIG.EMBED.THUMBS_UP_FIELD, value: `${thumbsUp}`, inline: true },
              { name: COMMAND_CONFIG.EMBED.THUMBS_DOWN_FIELD, value: `${thumbsDown}`, inline: true }
            )
            .setFooter({ text: COMMAND_CONFIG.EMBED.FOOTER });
          
          // Edit the deferred reply with the embed.
          await interaction.editReply({ embeds: [embed] });
          
          logger.info("Urban Dictionary definition sent successfully.", {
            userId: interaction.user.id,
            query: query,
            word: word
          });
        } else {
          // No definitions found.
          logger.info("No Urban Dictionary definitions found for query.", {
            userId: interaction.user.id,
            query: query
          });
          
          await interaction.editReply({ 
            content: COMMAND_CONFIG.RESPONSES.NO_DEFINITION, 
            ephemeral: true 
          });
        }
      } else {
        // Log if the API response was not successful.
        logger.warn("Urban Dictionary API returned non-200 status code.", {
          userId: interaction.user.id,
          query: query,
          status: response.status,
          statusText: response.statusText
        });
        
        await interaction.editReply({ 
          content: COMMAND_CONFIG.RESPONSES.API_ERROR.replace('%s', response.status), 
          ephemeral: true 
        });
      }
    } catch (error) {
      // Handle network errors or other exceptions.
      logger.error("Error executing Urban Dictionary command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        query: interaction.options.getString(COMMAND_CONFIG.OPTIONS.QUERY.NAME)
      });
      
      // Determine if interaction has already been deferred.
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: COMMAND_CONFIG.RESPONSES.GENERAL_ERROR, 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: COMMAND_CONFIG.RESPONSES.GENERAL_ERROR, 
          ephemeral: true 
        });
      }
    }
  }
};
