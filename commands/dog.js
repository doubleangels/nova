const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const dayjs = require('dayjs');

/**
 * Module for the /dog command.
 * Fetches a random dog image from the Dog CEO API and sends it as an embed.
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
      // Defer reply to allow asynchronous operations.
      await interaction.deferReply();
      logger.debug("/cat command received:", { user: interaction.user.tag });
      const dogApiUrl = "https://dog.ceo/api/breeds/image/random";
      logger.debug("Fetching random dog image data:", { url: dogApiUrl });
      
      // Fetch the random dog image data.
      const response = await fetch(dogApiUrl);
      logger.debug("Dog CEO API response received:", { status: response.status });
      
      if (response.status === 200) {
        const data = await response.json();
        const imageUrl = data.message;
        
        if (imageUrl) {
          // Append a timestamp query to avoid potential caching issues.
          const timestamp = dayjs().unix();
          const imageUrlWithTimestamp = `${imageUrl}?timestamp=${timestamp}`;
          logger.debug("Fetching dog image file:", { imageUrl: imageUrlWithTimestamp });
          
          // Fetch the dog image file.
          const imageResponse = await fetch(imageUrlWithTimestamp);
          logger.debug("Dog image file response:", { status: imageResponse.status });
          
          if (imageResponse.status === 200) {
            const imageBuffer = await imageResponse.buffer();
            const filename = "dog.jpg";
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
            logger.debug("Dog image sent successfully:", { user: interaction.user.tag });
          } else {
            logger.warn("Error fetching dog image file:", { status: imageResponse.status });
            await interaction.editReply("🐶 Couldn't fetch a dog picture. Try again later.");
          }
        } else {
          logger.warn("No dog image URL found in API response:", { responseData: data });
          await interaction.editReply("🐶 Couldn't find a dog picture. Try again later.");
        }
      } else {
        logger.warn("Dog CEO API error:", { status: response.status });
        await interaction.editReply("🐕 Couldn't fetch a dog picture. Try again later.");
      }
    } catch (error) {
      logger.error("Error in /dog command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
