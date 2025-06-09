/**
 * Dog command module for fetching and displaying random dog images.
 * Handles API interactions with The Dog API and image display formatting.
 * @module commands/dog
 */

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const { logError } = require('../errors');

const DOG_API_BASE_URL = 'https://api.thedogapi.com/v1';
const DOG_API_ENDPOINT = '/images/search';
const DOG_API_URL = "https://dog.ceo/api/breeds/image/random";

const DOG_EMBED_COLOR = 0xA0522D;
const DOG_EMBED_FOOTER = 'Powered by The Dog API';
const DOG_EMBED_TITLE = '🐕 Random Dog';

const DOG_DEFAULT_FILENAME = "dog.jpg";

const DOG_ERROR_API = "⚠️ Couldn't fetch a dog picture due to an API error. Try again later.";
const DOG_ERROR_IMAGE_FETCH = "⚠️ Couldn't download the dog picture. Try again later.";
const DOG_ERROR_NETWORK = "⚠️ Network error: Could not connect to the service. Please check your internet connection.";
const DOG_ERROR_NO_IMAGE = "⚠️ Couldn't find a dog picture. Try again later.";
const DOG_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while fetching the dog image.";

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
   * Executes the dog command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If API request fails
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      logger.info("Dog command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });
      
      const response = await axios.get('https://api.thedogapi.com/v1/images/search');
      const dogData = response.data[0];
      
      const embed = new EmbedBuilder()
        .setColor('#A0522D')
        .setTitle('🐕 Random Dog')
        .setImage(dogData.url)
        .setFooter({ text: 'Powered by The Dog API' });
      
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
   * Fetches a dog image from the API.
   * @async
   * @function fetchDogImage
   * @returns {Promise<Buffer>} The dog image buffer
   * @throws {Error} If API request fails or returns invalid response
   */
  async fetchDogImage() {
    logger.debug("Fetching random dog image data:", { url: DOG_API_URL });
    
    try {
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
      
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      
      if (imageResponse.status !== 200) {
        logger.warn("Error fetching dog image file:", { status: imageResponse.status });
        throw new Error("IMAGE_FETCH_ERROR");
      }
      
      return Buffer.from(imageResponse.data);
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
   * Creates an embed for displaying dog images.
   * @function createDogEmbed
   * @returns {EmbedBuilder} The formatted embed
   */
  createDogEmbed() {
    return new EmbedBuilder()
      .setTitle("Random Dog Picture")
      .setDescription("🐶 Here's a doggo for you!")
      .setColor(DOG_EMBED_COLOR)
      .setImage(`attachment://${DOG_DEFAULT_FILENAME}`)
      .setFooter({ text: DOG_EMBED_FOOTER });
  },
  
  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'dog', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = DOG_ERROR_UNEXPECTED;
    
    if (error.message === "API_ERROR") {
      errorMessage = DOG_ERROR_API;
    } else if (error.message === "NO_IMAGE_URL") {
      errorMessage = DOG_ERROR_NO_IMAGE;
    } else if (error.message === "IMAGE_FETCH_ERROR") {
      errorMessage = DOG_ERROR_IMAGE_FETCH;
    } else if (error.message === "NETWORK_ERROR") {
      errorMessage = DOG_ERROR_NETWORK;
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
      });
    }
  }
};
