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
   * @param {Interaction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    try {
      // Defer reply to allow time for asynchronous operations.
      await interaction.deferReply();
      logger.info("Cat command initiated.", { userId: interaction.user.id });

      // Fetch the cat image from the Cataas API using axios with responseType 'arraybuffer'.
      logger.debug("Fetching cat image from API.");
      const response = await axios.get(CAT_API_URL, { 
        responseType: 'arraybuffer', 
        headers: { 'Accept': 'image/*' }
      });

      if (response.status === 200) {
        // Convert the response data to a buffer.
        const imageBuffer = Buffer.from(response.data);
        
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
      } else {
        logger.warn("Cataas API returned an unexpected status code.", { 
          status: response.status,
          userId: interaction.user.id 
        });
        
        await interaction.editReply({
          content: "⚠️ Couldn't fetch a cat picture. Try again later.", 
          ephemeral: true
        });
      }
    } catch (error) {
      const errorMessage = error.response 
        ? `API responded with status ${error.response.status}` 
        : error.message || "Unknown error";
        
      logger.error("Error in cat command execution.", { 
        error: errorMessage, 
        stack: error.stack,
        userId: interaction.user.id
      });
      
      // Determine if interaction can still be replied to
      if (interaction.deferred) {
        await interaction.editReply({
          content: "⚠️ An unexpected error occurred while fetching the cat image. Please try again later.",
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: "⚠️ An unexpected error occurred. Please try again later.",
          ephemeral: true
        });
      }
    }
  }
};
