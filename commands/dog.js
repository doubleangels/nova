const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

// We use these configuration constants for the dog command.
const DOG_API_URL = "https://dog.ceo/api/breeds/image/random";
const EMBED_COLOR = 0xD3D3D3;
const IMAGE_FILENAME = "dog.jpg";

/**
 * We handle the dog command.
 * This function fetches and displays a random dog image.
 *
 * We perform several tasks:
 * 1. Fetch a random dog image from the API
 * 2. Create an embed with the dog image
 * 3. Send the embed to the user
 *
 * @param {Interaction} interaction - The Discord interaction object
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('We fetch and display a random dog image.'),
  
  /**
   * Executes the /dog command.
   * @param {ChatInputCommandInteraction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    try {
      // We defer the reply since the API call might take a moment.
      await interaction.deferReply();
      
      logger.info("Dog command initiated.", {
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
      
      logger.info("Dog command completed successfully.", {
        userId: interaction.user.id,
        imageUrl: dogData.url
      });
    } catch (error) {
      logger.error("Error executing dog command:", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id
      });
      
      // We inform the user if something goes wrong.
      await interaction.editReply({
        content: "⚠️ We couldn't fetch a dog image. Please try again later.",
        ephemeral: true
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
    
    // First, we get the image URL from the Dog CEO API.
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
    
    // Next, we fetch the actual image data from the URL provided.
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    
    if (imageResponse.status !== 200) {
      logger.warn("Error fetching dog image file.", { status: imageResponse.status });
      throw new Error("IMAGE_FETCH_ERROR");
    }
    
    // We return the image as a buffer for Discord to display.
    return Buffer.from(imageResponse.data);
  },
  
  /**
   * Creates an embed for the dog image with a nice presentation.
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
   * Gets a user-friendly error message based on the error type.
   * @param {Error} error - The error object.
   * @returns {string} A user-friendly error message explaining the issue.
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
