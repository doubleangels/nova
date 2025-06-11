/**
 * Dog command module for fetching and displaying random dog images.
 * Handles API interactions with Dog CEO API and image display formatting.
 * @module commands/dog
 */

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const { logError } = require('../errors');

/**
 * We handle the dog command.
 * This function fetches and displays a random dog image.
 *
 * We perform several tasks:
 * 1. We fetch a random dog image from the API.
 * 2. We create an embed with the dog image.
 * 3. We send the embed to the user.
 *
 * @param {Interaction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Get a random dog image!'),
  
  /**
   * Executes the dog command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If API request fails
   */
  async execute(interaction) {
    // Early validation of interaction
    if (!interaction || !interaction.isChatInputCommand()) {
      logger.error("Invalid interaction received:", {
        type: interaction?.type,
        userId: interaction?.user?.id
      });
      return;
    }

    let hasResponded = false;
    const respond = async (content, ephemeral = true) => {
      if (hasResponded) return;
      try {
        const options = typeof content === 'string' 
          ? { content, ephemeral }
          : { ...content, ephemeral };
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply(options);
        } else {
          await interaction.editReply(options);
        }
        hasResponded = true;
      } catch (error) {
        logger.error("Failed to respond to interaction:", {
          error: error.message,
          userId: interaction.user?.id
        });
      }
    };

    try {
      logger.info("/dog command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });
      
      const response = await axios.get('https://dog.ceo/api/breeds/image/random');
      const imageUrl = response.data.message;
      
      const embed = new EmbedBuilder()
        .setColor(0xA0522D)
        .setTitle('🐕 Random Dog')
        .setImage(imageUrl)
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();
      
      await respond({ embeds: [embed] }, false);
      
      logger.info("Dog command completed successfully:", {
        userId: interaction.user.id,
        imageUrl
      });
    } catch (error) {
      logError(error, 'dog', {
        userId: interaction.user?.id,
        guildId: interaction.guild?.id
      });
      
      await respond("⚠️ Failed to fetch a dog image. Please try again later.");
    }
  },
  
  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'dog', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while fetching the dog image.";
    
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
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for dog command:", {
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
