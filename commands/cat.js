const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch');

/**
 * Module for the /cat command.
 * Fetches a random cat image from the Cataas API and sends it as an embed.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Get a random cat picture!'),
  
  /**
   * Executes the /cat command.
   * @param {Interaction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    try {
      // Defer reply to allow time for asynchronous operations.
      await interaction.deferReply();
      logger.debug("/cat command received:", { user: interaction.user.tag });

      // Define the Cataas API URL.
      const catApiUrl = `https://cataas.com/cat/cute`;
      logger.debug("Fetching cat image:", { catApiUrl });

      // Fetch the cat image using node-fetch.
      const response = await fetch(catApiUrl, { headers: { 'Accept': 'image/*' } });
      logger.debug("Cataas API response:", { status: response.status });

      if (response.ok) {
        // Convert the response to an ArrayBuffer and then to a Buffer.
        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);
        const filename = "cat.jpg";

        // Create an attachment from the image buffer.
        const attachment = new AttachmentBuilder(imageBuffer, { name: filename });

        // Build an embed with the cat image.
        const embed = new EmbedBuilder()
          .setTitle("Random Cat Picture")
          .setDescription("😺 Here's a cat for you!")
          .setColor(0xD3D3D3)
          .setImage(`attachment://${filename}`)
          .setFooter({ text: "Powered by Cataas API" });
        
        // Edit the reply with the embed and attachment.
        await interaction.editReply({ embeds: [embed], files: [attachment] });
        logger.debug("Cat image sent successfully:", { user: interaction.user.tag });
      } else {
        logger.warn("Cataas API returned an error:", { status: response.status });
        await interaction.editReply("😿 Couldn't fetch a cat picture. Try again later.");
      }
    } catch (error) {
      logger.error("Error in /cat command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
