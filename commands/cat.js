const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch').default;
const logger = require('../logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Get a random cat picture!'),
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const timestamp = Math.floor(Date.now() / 1000);
      const catApiUrl = `https://cataas.com/cat?timestamp=${timestamp}`;
      logger.debug(`Fetching cat image from ${catApiUrl}`);

      const response = await fetch(catApiUrl);
      if (response.ok) {
        const imageBuffer = await response.buffer();
        const filename = "cat.jpg";
        const attachment = new AttachmentBuilder(imageBuffer, { name: filename });

        const embed = new EmbedBuilder()
          .setTitle("Random Cat Picture")
          .setDescription("😺 Here's a cat for you!")
          .setColor(0xD3D3D3)
          .setImage(`attachment://${filename}`)
          .setFooter({ text: "Powered by Cataas API" });

        await interaction.editReply({ embeds: [embed], files: [attachment] });
        logger.debug("Cat image sent successfully.");
      } else {
        logger.warn(`Cataas API error: ${response.status}`);
        await interaction.editReply("😿 Couldn't fetch a cat picture. Try again later.");
      }
    } catch (error) {
      logger.error(`Error in /cat command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
