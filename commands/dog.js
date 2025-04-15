const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// Configuration constants
const DOG_API_URL = "https://dog.ceo/api/breeds/image/random";
const EMBED_COLOR = 0xD3D3D3;
const IMAGE_FILENAME = "dog.jpg";

/**
 * Module for the /dog command.
 * Fetches a random dog image from the Dog CEO API and sends it as an embed.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Get a random dog picture.'),
  
  /**
   * Executes the /dog command.
   * @param {ChatInputCommandInteraction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    try {
      // Defer reply to allow asynchronous operations.
      await interaction.deferReply();
      logger.info("Dog command initiated.", { userId: interaction.user.id });
      
      // Fetch dog image and create embed
      const imageBuffer = await this.fetchDogImage();
      const embed = this.createDogEmbed();
      const attachment = new AttachmentBuilder(imageBuffer, { name: IMAGE_FILENAME });
            
      // Send the response
      await interaction.editReply({ embeds: [embed], files: [attachment] });
      logger.info("Dog image sent successfully.", { userId: interaction.user.id });
    } catch (error) {
      logger.error("Error in dog command execution.", { 
        error: error.message, 
        stack: error.stack,
        userId: interaction.user.id
      });
      
      await interaction.editReply({
        content: `⚠️ ${this.getErrorMessage(error)}`
      });
    }
  },
  
  /**
   * Fetches a random dog image from the Dog CEO API.
   * @returns {Promise<Buffer>} A buffer containing the image data.
   * @throws {Error} If the image cannot be fetched.
   */
  async fetchDogImage() {
    logger.debug("Fetching random dog image data.", { url: DOG_API_URL });
    
    // Step 1: Get the image URL from the Dog CEO API
    const response = await axios.get(DOG_API_URL);
    
    if (response.status !== 200) {
      logger.warn("Dog CEO API error.", { status: response.status });
      throw new Error("API_ERROR");
    }
    
    const imageUrl = response.data.message;
    
    if (!imageUrl) {
      logger.warn("No dog image URL found in API response.", { responseData: response.data });
      throw new Error("NO_IMAGE_URL");
    }
    
    logger.debug("Dog image URL received.", { imageUrl });
    
    // Step 2: Fetch the actual image data
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    
    if (imageResponse.status !== 200) {
      logger.warn("Error fetching dog image file.", { status: imageResponse.status });
      throw new Error("IMAGE_FETCH_ERROR");
    }
    
    // Return the image as a buffer
    return Buffer.from(imageResponse.data);
  },
  
  /**
   * Creates an embed for the dog image.
   * @returns {EmbedBuilder} The created embed.
   */
  createDogEmbed() {
    return new EmbedBuilder()
      .setTitle("Random Dog Picture")
      .setDescription("🐶 Here's a doggo for you!")
      .setColor(EMBED_COLOR)
      .setImage(`attachment://${IMAGE_FILENAME}`)
      .setFooter({ text: "Powered by Dog CEO API" });
  },
  
  /**
   * Gets a user-friendly error message based on the error.
   * @param {Error} error - The error object.
   * @returns {string} A user-friendly error message.
   */
  getErrorMessage(error) {
    if (error.message === "API_ERROR") {
      return "Couldn't fetch a dog picture due to an API error. Try again later.";
    } else if (error.message === "NO_IMAGE_URL") {
      return "Couldn't find a dog picture. Try again later.";
    } else if (error.message === "IMAGE_FETCH_ERROR") {
      return "Couldn't download the dog picture. Try again later.";
    } else if (axios.isAxiosError(error) && !error.response) {
      return "Network error: Could not connect to the dog image service. Please check your internet connection.";
    }
    return "An unexpected error occurred while fetching the dog image. Please try again later.";
  }
};
