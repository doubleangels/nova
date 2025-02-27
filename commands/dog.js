const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Get a random dog picture!'),
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const dogApiUrl = "https://dog.ceo/api/breeds/image/random";
      logger.debug(`Fetching random dog image data from ${dogApiUrl}`);
      
      const response = await fetch(dogApiUrl);
      if (response.status === 200) {
        const data = await response.json();
        const imageUrl = data.message;
        
        if (imageUrl) {
          const timestamp = Math.floor(Date.now() / 1000);
          const imageUrlWithTimestamp = `${imageUrl}?timestamp=${timestamp}`;
          logger.debug(`Fetching dog image from ${imageUrlWithTimestamp}`);
          
          const imageResponse = await fetch(imageUrlWithTimestamp);
          if (imageResponse.status === 200) {
            const imageBuffer = await imageResponse.buffer();
            const filename = "dog.jpg";
            const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
            
            const embed = new EmbedBuilder()
              .setTitle("Random Dog Picture")
              .setDescription("🐶 Here's a doggo for you!")
              .setColor(0xD3D3D3)
              .setImage(`attachment://${filename}`)
              .setFooter({ text: "Powered by Dog CEO API" });
            
            await interaction.editReply({ embeds: [embed], files: [attachment] });
            logger.debug("Dog image sent successfully.");
          } else {
            logger.warn(`Error fetching dog image file: ${imageResponse.status}`);
            await interaction.editReply("🐶 Couldn't fetch a dog picture. Try again later.");
          }
        } else {
          logger.warn("No dog image URL found in the API response.");
          await interaction.editReply("🐶 Couldn't find a dog picture. Try again later.");
        }
      } else {
        logger.warn(`Dog CEO API error: ${response.status}`);
        await interaction.editReply("🐕 Couldn't fetch a dog picture. Try again later.");
      }
    } catch (error) {
      logger.error(`Error in /dog command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
