const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

/**
 * Command module for fetching and displaying random cat images
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Fetch and display a random cat image.'),

  /**
   * Executes the cat command
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<void>}
   * @throws {Error} If the command execution fails
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      logger.info("/cat command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });

      const response = await axios.get('https://api.thecatapi.com/v1/images/search');
      const catData = response.data[0];
      
      const embed = new EmbedBuilder()
        .setColor(0xFFB6C1)
        .setTitle('🐱 Random Cat')
        .setImage(catData.url)
        .setFooter({ text: 'Powered by The Cat API' });
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/cat command completed successfully:", {
        userId: interaction.user.id,
        imageUrl: catData.url
      });
    } catch (error) {
      logger.error("Error in cat command:", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });

      let errorMessage = "⚠️ An unexpected error occurred. Please try again later.";
      
      if (error.message === "API_ERROR") {
        errorMessage = "⚠️ Couldn't fetch a cat picture due to an API error. Try again later.";
      } else if (error.message === "INVALID_RESPONSE") {
        errorMessage = "⚠️ The cat service didn't send a proper image. Please try again.";
      } else if (error.message === "NETWORK_ERROR") {
        errorMessage = "⚠️ Couldn't connect to the cat image service. Please check your internet connection.";
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
        }).catch(() => {});
      }
    }
  },

  /**
   * Fetches a random cat image from the Cat API
   * @returns {Promise<Buffer>} The cat image as a buffer
   * @throws {Error} If the API request fails or returns invalid data
   */
  async fetchCatImage() {
    logger.debug("Fetching cat image from API.");
    try {
      const response = await axios.get('https://cataas.com/cat/cute', { 
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
  }
};