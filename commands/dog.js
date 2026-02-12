const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

/**
 * Command module for fetching and displaying random dog images.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Fetch and display a random dog image.')
    .setDefaultMemberPermissions(null),

  /**
   * Executes the dog image command.
   * This function:
   * 1. Fetches a random dog image from the Dog CEO API
   * 2. Creates and sends an embed with the image
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error fetching or displaying the image
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      logger.info("/dog command initiated.", {
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
        .setTitle('Random Dog')
        .setImage(dogData.message)
        .setFooter({ text: 'Powered by Dog CEO API' });
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/dog command completed successfully.", {
        userId: interaction.user.id,
        imageUrl: dogData.message
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles errors that occur during command execution.
   * Logs the error and sends an appropriate error message to the user.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error occurred in dog command.", {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while fetching the dog image. Please try again later.";
    
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
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for dog command.", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  }
};