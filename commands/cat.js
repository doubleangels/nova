/**
 * Cat command module for fetching and displaying random cat images.
 * Handles API interactions with The Cat API and image display formatting.
 * @module commands/cat
 */

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

const CAT_API_URL = 'https://cataas.com/cat/cute';
const CAT_EMBED_COLOR = 0xD3D3D3;
const DEFAULT_FILENAME = 'cat.jpg';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Fetch and display a random cat image.'),

  /**
   * Executes the cat command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If API request fails
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      logger.info("Cat command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });

      const response = await axios.get('https://api.thecatapi.com/v1/images/search');
      const catData = response.data[0];
      
      const embed = new EmbedBuilder()
        .setColor('#FFB6C1')
        .setTitle('🐱 Random Cat')
        .setImage(catData.url)
        .setFooter({ text: 'Powered by The Cat API' });
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Cat command completed successfully:", {
        userId: interaction.user.id,
        imageUrl: catData.url
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Fetches a cat image from the API.
   * @async
   * @function fetchCatImage
   * @returns {Promise<Buffer>} The cat image buffer
   * @throws {Error} If API request fails or returns invalid response
   */
  async fetchCatImage() {
    logger.debug("Fetching cat image from API.");
    try {
      const response = await axios.get(CAT_API_URL, { 
        responseType: 'arraybuffer', 
        headers: { 'Accept': 'image/*' }
      });

      if (response.status !== 200) {
        logger.warn("API returned non-200 status:", { status: response.status });
        throw new Error("API_ERROR");
      }

      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        logger.warn("API did not return an image:", { contentType });
        throw new Error("INVALID_RESPONSE");
      }

      return Buffer.from(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          logger.warn("API error response:", { 
            status: error.response.status,
            statusText: error.response.statusText
          });
          throw new Error("API_ERROR");
        } else if (error.request) {
          logger.warn("Network error - no response received.");
          throw new Error("NETWORK_ERROR");
        }
      }
      throw error;
    }
  },

  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'cat', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.CAT_API_ERROR;
    } else if (error.message === "INVALID_RESPONSE") {
      errorMessage = ERROR_MESSAGES.CAT_INVALID_IMAGE;
    } else if (error.message === "NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.CAT_NETWORK_ERROR;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for cat command:", {
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
