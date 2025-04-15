const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// Configuration constants.
const CAT_API_URL = 'https://cataas.com/cat/cute';
const CAT_EMBED_COLOR = 0xD3D3D3;
const DEFAULT_FILENAME = 'cat.jpg';

/**
 * Module for the /cat command.
 * Fetches a random cat image from the Cataas API and sends it as an embed.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Get a random cat picture.'),
  
  /**
   * Executes the /cat command.
   * @param {ChatInputCommandInteraction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    try {
      // Defer reply to allow time for asynchronous operations.
      await interaction.deferReply();
      logger.info("Cat command initiated.", { userId: interaction.user.id });

      // Fetch cat image
      const imageBuffer = await this.fetchCatImage();
      // Create an attachment from the image buffer.
      const attachment = new AttachmentBuilder(imageBuffer, { name: DEFAULT_FILENAME });

      // Build an embed with the cat image.
      const embed = new EmbedBuilder()
        .setTitle("Random Cat Picture")
        .setDescription("😺 Here's a cat for you!")
        .setColor(CAT_EMBED_COLOR)
        .setImage(`attachment://${DEFAULT_FILENAME}`)
        .setFooter({ text: "Powered by Cataas API" });
        
      // Edit the reply with the embed and attachment.
      await interaction.editReply({ embeds: [embed], files: [attachment] });
      logger.info("Cat image sent successfully.", { userId: interaction.user.id });
    } catch (error) {
      logger.error("Error in cat command execution.", { 
        error: error.message, 
        stack: error.stack,
        userId: interaction.user.id
      });
      
      // Determine if interaction can still be replied to
      if (interaction.deferred) {
        await interaction.editReply({
          content: `⚠️ ${this.getErrorMessage(error)}`
        });
      } else {
        await interaction.reply({
          content: `⚠️ ${this.getErrorMessage(error)}`,
          ephemeral: true
        });
      }
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

      // Verify that we received an image
      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        logger.warn("API did not return an image.", { contentType });
        throw new Error("The API did not return a valid image");
      }

      // Convert the response data to a buffer.
      return Buffer.from(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new Error(`API error: ${error.response.status}`);
        } else if (error.request) {
          throw new Error("Network error: Could not connect to the cat API");
        }
      }
      throw error; // Re-throw any other errors
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
