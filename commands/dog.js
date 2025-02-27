const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;

/**
 * Module for the /dog command.
 * This command fetches a random dog image from the Dog CEO API and sends it as an embed.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Get a random dog picture!'),
  
  /**
   * Executes the /dog command.
   * @param {Interaction} interaction - The interaction object from Discord.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for the asynchronous operations.
      await interaction.deferReply();
      const dogApiUrl = "https://dog.ceo/api/breeds/image/random";
      logger.debug(`Fetching random dog image data from ${dogApiUrl}`);
      
      // Fetch the random dog image data from the Dog CEO API.
      const response = await fetch(dogApiUrl);
      if (response.status === 200) {
        const data = await response.json();
        const imageUrl = data.message;
        
        if (imageUrl) {
          // Append a timestamp query to avoid potential caching issues.
          const timestamp = Math.floor(Date.now() / 1000);
          const imageUrlWithTimestamp = `${imageUrl}?timestamp=${timestamp}`;
          logger.debug(`Fetching dog image from ${imageUrlWithTimestamp}`);
          
          // Fetch the actual dog image file.
          const imageResponse = await fetch(imageUrlWithTimestamp);
          if (imageResponse.status === 200) {
            const imageBuffer = await imageResponse.buffer();
            const filename = "dog.jpg";
            // Create an attachment from the image buffer.
            const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
            
            // Build an embed to display the dog image.
            const embed = new EmbedBuilder()
              .setTitle("Random Dog Picture")
              .setDescription("🐶 Here's a doggo for you!")
              .setColor(0xD3D3D3)
              .setImage(`attachment://${filename}`)
              .setFooter({ text: "Powered by Dog CEO API" });
            
            // Edit the deferred reply with the embed and attached image.
            await interaction.editReply({ embeds: [embed], files: [attachment] });
            logger.debug("Dog image sent successfully.");
          } else {
            // Log and inform the user if fetching the image file fails.
            logger.warn(`Error fetching dog image file: ${imageResponse.status}`);
            await interaction.editReply("🐶 Couldn't fetch a dog picture. Try again later.");
          }
        } else {
          // Log and inform the user if the API response does not contain an image URL.
          logger.warn("No dog image URL found in the API response.");
          await interaction.editReply("🐶 Couldn't find a dog picture. Try again later.");
        }
      } else {
        // Log and inform the user if the initial API call fails.
        logger.warn(`Dog CEO API error: ${response.status}`);
        await interaction.editReply("🐕 Couldn't fetch a dog picture. Try again later.");
      }
    } catch (error) {
      // Log any unexpected errors and notify the user.
      logger.error(`Error in /dog command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
