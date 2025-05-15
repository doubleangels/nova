const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We use these configuration constants for the cat API.
const CAT_API_URL = 'https://cataas.com/cat/cute';
const CAT_EMBED_COLOR = 0xD3D3D3;
const DEFAULT_FILENAME = 'cat.jpg';

/**
 * We handle the cat command.
 * This function fetches and displays a random cat image.
 *
 * We perform several tasks:
 * 1. Fetch a random cat image from the API
 * 2. Create an embed with the cat image
 * 3. Send the embed to the user
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Fetch and display a random cat image.'),

  async execute(interaction) {
    try {
      // We defer the reply since the API call might take a moment.
      await interaction.deferReply();
      
      logger.info("Cat command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });

      // We fetch a random cat image from the API.
      const response = await axios.get('https://api.thecatapi.com/v1/images/search');
      const catData = response.data[0];
      
      // We create an embed to display the cat image.
      const embed = new EmbedBuilder()
        .setColor('#FFB6C1')
        .setTitle('🐱 Random Cat')
        .setImage(catData.url)
        .setFooter({ text: 'Powered by The Cat API' });
      
      // We send the embed to the user.
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Cat command completed successfully.", {
        userId: interaction.user.id,
        imageUrl: catData.url
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Fetches a cat image from the API.
   * @returns {Promise<Buffer>} A buffer containing the image data.
   * @throws {Error} If the image cannot be fetched.
   */
  async fetchCatImage() {
    logger.debug("Fetching cat image from API.");
    try {
      const response = await axios.get(CAT_API_URL, { 
        responseType: 'arraybuffer', 
        headers: { 'Accept': 'image/*' }
      });

      if (response.status !== 200) {
        logger.warn("API returned non-200 status.", { status: response.status });
        throw new Error("API_ERROR");
      }

      // We verify that we received an actual image from the API.
      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        logger.warn("API did not return an image.", { contentType });
        throw new Error("INVALID_RESPONSE");
      }

      // We convert the response data to a buffer for the attachment.
      return Buffer.from(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          logger.warn("API error response.", { 
            status: error.response.status,
            statusText: error.response.statusText
          });
          throw new Error("API_ERROR");
        } else if (error.request) {
          logger.warn("Network error - no response received.");
          throw new Error("NETWORK_ERROR");
        }
      }
      throw error; // We re-throw any other errors for consistent error handling.
    }
  },

  async handleError(interaction, error) {
    logError(error, 'cat', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    } else if (error.message === "INVALID_RESPONSE") {
      errorMessage = ERROR_MESSAGES.INVALID_RESPONSE;
    } else if (error.message === "NETWORK_ERROR") {
      errorMessage = ERROR_MESSAGES.NETWORK_ERROR;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for cat command.", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // Silent catch if everything fails.
      });
    }
  }
};
