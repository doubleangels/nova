const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

/**
 * Command module for fetching and displaying a random space image (NASA APOD)
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('space')
    .setDescription('Fetch and display a random space image.'),

  /**
   * Executes the space command.
   * Fetches a random APOD entry until an image is found, then displays it.
   * @param {CommandInteraction} interaction
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();

      logger.info("/space command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });

      // Request multiple entries to increase odds of getting an image (APOD can be videos)
      const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
      const url = `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(apiKey)}&count=5`;
      const response = await axios.get(url);
      const items = Array.isArray(response.data) ? response.data : [response.data];

      const imageItem = items.find(item => item.media_type === 'image' && (item.hdurl || item.url));
      if (!imageItem) {
        throw new Error('NO_IMAGE_AVAILABLE');
      }

      const imageUrl = imageItem.hdurl || imageItem.url;
      const title = imageItem.title || 'Random Space Image';
      const explanation = imageItem.explanation || '';

      const embed = new EmbedBuilder()
        .setColor(0x1E90FF)
        .setTitle(`🌌 ${title}`)
        .setImage(imageUrl)
        .setFooter({ text: 'Powered by NASA APOD' });

      if (explanation) {
        const trimmed = explanation.length > 300 ? `${explanation.slice(0, 297)}...` : explanation;
        embed.setDescription(trimmed);
      }

      await interaction.editReply({ embeds: [embed] });

      logger.info("/space command completed successfully:", {
        userId: interaction.user.id,
        imageUrl
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles errors that occur during command execution.
   * @param {CommandInteraction} interaction
   * @param {Error} error
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in space command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });

    let errorMessage = "⚠️ An unexpected error occurred while fetching the space image.";

    if (error.message === 'NO_IMAGE_AVAILABLE') {
      errorMessage = "⚠️ Couldn't find a space image right now. Please try again.";
    } else if (error.message === 'API_ERROR') {
      errorMessage = "⚠️ The space image service returned an error. Try again later.";
    } else if (error.message === 'NETWORK_ERROR') {
      errorMessage = "⚠️ Network error: Could not connect to the service.";
    }

    try {
      await interaction.editReply({
        content: errorMessage,
        ephemeral: true
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for space command:", {
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


