/**
 * Dog command module for fetching and displaying random dog images.
 * Handles API interactions with Dog CEO API and image display formatting.
 * @module commands/dog
 */

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const { logError } = require('../errors');

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
      
      logger.info("/dog command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });
      
      const response = await axios.get("https://dog.ceo/api/breeds/image/random");
      const dogData = response.data;
      
      if (!dogData.message) {
        throw new Error("NO_IMAGE_URL");
      }
      
      const embed = new EmbedBuilder()
        .setColor(0xA0522D)
        .setTitle('🐕 Random Dog')
        .setImage(dogData.message)
        .setFooter({ text: 'Powered by Dog CEO API' });
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/dog command completed successfully:", {
        userId: interaction.user.id,
        imageUrl: dogData.message
      });
    } catch (error) {
      await this.handleError(interaction, error);
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
    logError(error, 'dog', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while fetching the dog image.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Couldn't fetch a dog picture due to an API error. Try again later.";
    } else if (error.message === "NO_IMAGE_URL") {
      errorMessage = "⚠️ Couldn't find a dog picture. Try again later.";
    } else if (error.message === "IMAGE_FETCH_ERROR") {
      errorMessage = "⚠️ Couldn't download the dog picture. Try again later.";
    } else if (error.message === "NETWORK_ERROR") {
      errorMessage = "⚠️ Network error: Could not connect to the service. Please check your internet connection.";
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
      }).catch(() => {});
    }
  }
};