/**
 * Urban Dictionary command module for searching and displaying word definitions.
 * Handles API interactions, result formatting, and error management.
 * @module commands/urban
 */

const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('urban')
    .setDescription('Search for a word or phrase on Urban Dictionary.')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('The word or phrase to search for')
        .setRequired(true)
    ),
    
  /**
   * Executes the urban dictionary command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the search fails
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({ 
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
      }
      
      await interaction.deferReply();
      
      const query = interaction.options.getString('query');
      
      logger.info("/urban command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        query
      });

      const searchResult = await this.searchUrbanDictionary(query);
      
      if (searchResult.error) {
        return await interaction.editReply({
          content: searchResult.message,
          ephemeral: true
        });
      }
      
      await interaction.editReply(searchResult.message);
      logger.info("Urban Dictionary search completed successfully.", {
        userId: interaction.user.id,
        query,
        found: searchResult.found
      });
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * Validates that the required configuration is available.
   * @function validateConfiguration
   * @returns {boolean} True if configuration is valid, false otherwise
   */
  validateConfiguration() {
    if (!config.urbanApiKey) {
      logger.error("Urban Dictionary API key is not configured in the application.", {
        command: 'urban'
      });
      return false;
    }
    return true;
  },
  
  /**
   * Searches Urban Dictionary for a word or phrase.
   * @async
   * @function searchUrbanDictionary
   * @param {string} query - The search query
   * @returns {Promise<Object>} The search result with formatted message
   */
  async searchUrbanDictionary(query) {
    try {
      const response = await fetch(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(query)}`);
      
      if (!response.ok) {
        throw new Error(`API_ERROR: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.list || data.list.length === 0) {
        return {
          error: true,
          message: `No definitions found for "${query}".`,
          found: false
        };
      }
      
      const definition = data.list[0];
      const message = this.formatDefinition(definition);
      
      return {
        error: false,
        message,
        found: true
      };
    } catch (error) {
      logger.error("Error searching Urban Dictionary:", {
        error: error.message,
        query
      });
      throw error;
    }
  },
  
  /**
   * Formats a definition from Urban Dictionary into a message.
   * @function formatDefinition
   * @param {Object} definition - The definition object from Urban Dictionary
   * @returns {string} The formatted definition message
   */
  formatDefinition(definition) {
    const { word, definition: def, example, author, thumbs_up, thumbs_down } = definition;
    
    let message = `📚 **${word}**\n\n`;
    message += `**Definition:**\n${def}\n\n`;
    
    if (example) {
      message += `**Example:**\n${example}\n\n`;
    }
    
    message += `**Author:** ${author}\n`;
    message += `👍 ${thumbs_up} | 👎 ${thumbs_down}`;
    
    return message;
  },

  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'urban', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message.startsWith('API_ERROR')) {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = ERROR_MESSAGES.REQUEST_TIMEOUT;
    } else if (error.response?.status === 403) {
      errorMessage = ERROR_MESSAGES.API_ACCESS_DENIED;
    } else if (error.response?.status === 429) {
      errorMessage = ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;
    } else if (error.response?.status >= 500) {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for urban command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
      });
    }
  }
};