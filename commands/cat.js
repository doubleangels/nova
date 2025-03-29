const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

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
      logger.debug("/cat command received:", { user: interaction.user.tag });

      // Create a unique timestamp to avoid cached images using day.js.
      const catApiUrl = `https://cataas.com/cat/cute`;
      logger.debug("Fetching cat image:", { catApiUrl });

      // Fetch the cat image from the Cataas API using axios with responseType 'arraybuffer'.
      const response = await axios.get(catApiUrl, { responseType: 'arraybuffer', headers: { 'Accept': 'image/*' } });
      logger.debug("Cataas API response:", { status: response.status });

      if (response.status === 200) {
        // Convert the response data to a buffer using binary encoding.
        const imageBuffer = Buffer.from(response.data);
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
        await interaction.editReply({content: "⚠️ Couldn't fetch a cat picture. Try again later.", flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      logger.error("Error in /cat command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", flags: MessageFlags.Ephemeral });
    }
  }
};
