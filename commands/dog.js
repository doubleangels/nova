const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

// We define configuration constants for the dog command.
const DOG_API_URL = "https://dog.ceo/api/breeds/image/random";
const EMBED_COLOR = 0xD3D3D3;
const IMAGE_FILENAME = "dog.jpg";

/**
 * We handle the dog command.
 * This function fetches and displays a random dog image.
 *
 * We perform several tasks:
 * 1. We fetch a random dog image from the API.
 * 2. We create an embed with the dog image.
 * 3. We send the embed to the user.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Fetch and display a random dog image.'),
  
  /**
   * We execute the /dog command.
   * This function processes the dog image request and returns the result.
   *
   * @param {ChatInputCommandInteraction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    try {
      // We defer the reply since the API call might take a moment.
      await interaction.deferReply();
      
      logger.info("Dog command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });
      
      // We fetch a random dog image from the API.
      const response = await axios.get('https://api.thedogapi.com/v1/images/search');
      const dogData = response.data[0];
      
      // We create an embed to display the dog image.
      const embed = new EmbedBuilder()
        .setColor('#A0522D')
        .setTitle('🐕 Random Dog')
        .setImage(dogData.url)
        .setFooter({ text: 'Powered by The Dog API' });
      
      // We send the embed to the user.
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Dog command completed successfully:", {
        userId: interaction.user.id,
        imageUrl: dogData.url
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * We fetch a random dog image from the Dog CEO API.
   * This function retrieves and processes the image data.
   *
   * @returns {Promise<Buffer>} A buffer containing the image data.
   * @throws {Error} If the image cannot be fetched.
   */
  async fetchDogImage() {
    logger.debug("Fetching random dog image data:", { url: DOG_API_URL });
    
    // We get the image URL from the Dog CEO API.
    const response = await axios.get(DOG_API_URL);
    
    if (response.status !== 200) {
      logger.warn("Dog CEO API error:", { status: response.status });
      throw new Error("API_ERROR");
    }
    
    const imageUrl = response.data.message;
    
    if (!imageUrl) {
      logger.warn("No dog image URL found in API response:", { responseData: response.data });
      throw new Error("NO_IMAGE_URL");
    }
    
    logger.debug("Dog image URL received:", { imageUrl });
    
    // We fetch the actual image data from the URL provided.
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    
    if (imageResponse.status !== 200) {
      logger.warn("Error fetching dog image file:", { status: imageResponse.status });
      throw new Error("IMAGE_FETCH_ERROR");
    }
    
    // We return the image as a buffer for Discord to display.
    return Buffer.from(imageResponse.data);
  },
  
  /**
   * We create an embed for the dog image with a nice presentation.
   * This function formats the embed with appropriate styling and information.
   *
   * @returns {EmbedBuilder} The created embed with formatting for the dog image.
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
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'dog', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.DOG_API_ERROR;
    } else if (error.message === "NO_IMAGE_URL") {
      errorMessage = ERROR_MESSAGES.DOG_NO_IMAGE;
    } else if (error.message === "IMAGE_FETCH_ERROR") {
      errorMessage = ERROR_MESSAGES.DOG_IMAGE_FETCH_ERROR;
    } else if (axios.isAxiosError(error) && !error.response) {
      errorMessage = ERROR_MESSAGES.API_NETWORK_ERROR;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for dog command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // We silently catch if all error handling attempts fail.
      });
    }
  }
};
