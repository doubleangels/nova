const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { getUtcOffset, formatPlaceName, formatErrorMessage } = require('../utils/locationUtils');

/**
 * Module for the /timedifference command.
 * Calculates the time difference between two places by retrieving their UTC offsets.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('timedifference')
    .setDescription('Get the time difference between two places.')
    .addStringOption(option =>
      option
        .setName('place1')
        .setDescription('Enter the first city name (e.g., New York)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('place2')
        .setDescription('Enter the second city name (e.g., London)')
        .setRequired(true)
    ),
    
  /**
   * Executes the /timedifference command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Check if Google API key is configured.
      if (!config.googleApiKey) {
        logger.error("Google API key is not configured in the application.", {
          command: 'timedifference',
          userId: interaction.user.id
        });
        
        await interaction.reply({ 
          content: '⚠️ Google API key is not configured. This command is currently unavailable.', 
          ephemeral: true 
        });
        return;
      }
      
      // Defer reply to allow time for processing.
      await interaction.deferReply();
      
      const place1 = interaction.options.getString('place1');
      const place2 = interaction.options.getString('place2');
      
      logger.info("Time difference command initiated.", {
        userId: interaction.user.id,
        place1,
        place2
      });

      // Retrieve UTC offsets for both places in parallel.
      const [offset1Result, offset2Result] = await Promise.all([
        getUtcOffset(place1),
        getUtcOffset(place2)
      ]);
      
      // Handle specific errors for each place.
      if (offset1Result.error) {
        logger.warn("Failed to retrieve timezone for the first location.", {
          place: place1,
          errorType: offset1Result.errorType,
          userId: interaction.user.id
        });
        
        await interaction.editReply({
          content: formatErrorMessage(place1, offset1Result.errorType),
          ephemeral: true
        });
        return;
      }
      
      if (offset2Result.error) {
        logger.warn("Failed to retrieve timezone for the second location.", {
          place: place2,
          errorType: offset2Result.errorType,
          userId: interaction.user.id
        });
        
        await interaction.editReply({
          content: formatErrorMessage(place2, offset2Result.errorType),
          ephemeral: true
        });
        return;
      }

      // Calculate the absolute time difference.
      const timeDiff = Math.abs(offset1Result.offset - offset2Result.offset);
      
      // Format the place names (trim and capitalize first letter).
      const formattedPlace1 = formatPlaceName(place1);
      const formattedPlace2 = formatPlaceName(place2);

      // Create and send the reply message.
      const message = `⏳ The time difference between **${formattedPlace1}** and **${formattedPlace2}** is **${timeDiff} hours**.`;
        
      await interaction.editReply(message);
      
      logger.info("Time difference calculation completed successfully.", {
        userId: interaction.user.id,
        place1: formattedPlace1,
        place2: formattedPlace2,
        timeDiff
      });
      
    } catch (error) {
      logger.error("Error executing time difference command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id
      });
      
      await interaction.editReply({
        content: '⚠️ An unexpected error occurred. Please try again later.',
        ephemeral: true
      });
    }
  }
};
