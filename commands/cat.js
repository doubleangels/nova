const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

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
    .setDescription('We fetch and display a random cat image.'),

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
      logger.error("Error executing cat command:", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id
      });
      
      // We inform the user if something goes wrong.
      await interaction.editReply({
        content: "⚠️ We couldn't fetch a cat image. Please try again later.",
        ephemeral: true
      });
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
        throw new Error(`API returned status code ${response.status}`);
      }

      // We verify that we received an actual image from the API.
      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        logger.warn("API did not return an image.", { contentType });
        throw new Error("The API did not return a valid image");
      }

      // We convert the response data to a buffer for the attachment.
      return Buffer.from(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new Error(`API error: ${error.response.status}`);
        } else if (error.request) {
          throw new Error("Network error: Could not connect to the cat API");
        }
      }
      throw error; // We re-throw any other errors for consistent error handling.
    }
  },

  /**
   * Gets a user-friendly error message based on the error.
   * @param {Error} error - The error object.
   * @returns {string} A user-friendly error message.
   */
  getErrorMessage(error) {
    if (error.message.includes("API error")) {
      return "Couldn't fetch a cat picture due to an API error. Try again later.";
    } else if (error.message.includes("Network error")) {
      return "Couldn't connect to the cat image service. Please check your internet connection and try again.";
    } else if (error.message.includes("not return a valid image")) {
      return "The cat service didn't send a proper image. Please try again.";
    }
    return "An unexpected error occurred while fetching the cat image. Please try again later.";
  }
};
