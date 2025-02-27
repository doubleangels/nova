const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;

/**
 * Module for the /cat command.
 * This command fetches a random cat image from the Cataas API and sends it as an embed.
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
      // Defer the reply to allow for asynchronous operations.
      await interaction.deferReply();
      
      // Create a unique timestamp to avoid cached images.
      const timestamp = Math.floor(Date.now() / 1000);
      const catApiUrl = `https://cataas.com/cat?timestamp=${timestamp}`;
      logger.debug(`Fetching cat image from ${catApiUrl}`);

      // Fetch the cat image from the API.
      const response = await fetch(catApiUrl);
      if (response.ok) {
        // Convert the response data to a buffer.
        const imageBuffer = await response.buffer();
        const filename = "cat.jpg";
        // Create an attachment with the image buffer.
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
        logger.debug("Cat image sent successfully.");
      } else {
        // Log and reply if the API returned an error status.
        logger.warn(`Cataas API error: ${response.status}`);
        await interaction.editReply("😿 Couldn't fetch a cat picture. Try again later.");
      }
    } catch (error) {
      // Log unexpected errors and inform the user.
      logger.error(`Error in /cat command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
