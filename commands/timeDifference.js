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
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Check if Google API key is configured.
      if (!this.validateConfiguration()) {
        return await interaction.reply({ 
          content: '⚠️ Google API key is not configured. This command is currently unavailable.'
        });
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

      // Get time difference information
      const timeDiffResult = await this.calculateTimeDifference(place1, place2);
      
      if (timeDiffResult.error) {
        return await interaction.editReply({
          content: timeDiffResult.message
        });
      }
      
      // Create and send the reply message
      await interaction.editReply(timeDiffResult.message);
      logger.info("Time difference calculation completed successfully.", {
        userId: interaction.user.id,
        place1: timeDiffResult.formattedPlace1,
        place2: timeDiffResult.formattedPlace2,
        timeDiff: timeDiffResult.timeDiff,
        timeZone1: timeDiffResult.timeZone1,
        timeZone2: timeDiffResult.timeZone2
      });
      
    } catch (error) {
      logger.error("Error executing time difference command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id
      });
      
      await interaction.editReply({
        content: '⚠️ An unexpected error occurred. Please try again later.'
      });
    }
  },
  
  /**
   * Validates that the required configuration is available.
   * @returns {boolean} True if configuration is valid, false otherwise.
   */
  validateConfiguration() {
    if (!config.googleApiKey) {
      logger.error("Google API key is not configured in the application.", {
        command: 'timedifference'
      });
      return false;
    }
    return true;
  },
  
  /**
   * Calculates the time difference between two places.
   * @param {string} place1 - The first place name.
   * @param {string} place2 - The second place name.
   * @returns {Promise<Object>} The time difference result.
   */
  async calculateTimeDifference(place1, place2) {
    // Retrieve UTC offsets for both places in parallel
    const [offset1Result, offset2Result] = await Promise.all([
      getUtcOffset(place1),
      getUtcOffset(place2)
    ]);
    
    // Handle specific errors for each place
    if (offset1Result.error) {
      logger.warn("Failed to retrieve timezone for the first location.", {
        place: place1,
        errorType: offset1Result.errorType
      });
      
      return {
        error: true,
        message: formatErrorMessage(place1, offset1Result.errorType)
      };
    }

    if (offset2Result.error) {
      logger.warn("Failed to retrieve timezone for the second location.", {
        place: place2,
        errorType: offset2Result.errorType
      });
      
      return {
        error: true,
        message: formatErrorMessage(place2, offset2Result.errorType)
      };
    }

    // Format the place names (trim and capitalize first letter)
    const formattedPlace1 = formatPlaceName(place1);
    const formattedPlace2 = formatPlaceName(place2);
    
    // Calculate the time difference (keeping the sign)
    const rawTimeDiff = offset1Result.offset - offset2Result.offset;
    const timeDiff = Math.abs(rawTimeDiff);
    
    // Determine which place is ahead
    const aheadPlace = rawTimeDiff > 0 ? formattedPlace1 : 
                      rawTimeDiff < 0 ? formattedPlace2 : null;
    
    // Format the time difference for display
    const formattedTimeDiff = this.formatTimeDifference(timeDiff);
    
    // Create the response message
    let message = `⏳ **Time Difference Information:**\n\n`;
    
    // Add time zone information
    message += `• **${formattedPlace1}**: ${this.formatTimeZone(offset1Result)}\n`;
    message += `• **${formattedPlace2}**: ${this.formatTimeZone(offset2Result)}\n\n`;
    
    // Add the time difference
    if (rawTimeDiff === 0) {
      message += `**${formattedPlace1}** and **${formattedPlace2}** are in the same time zone.`;
    } else {
      message += `The time difference is **${formattedTimeDiff}**.`;
      message += `\n**${aheadPlace}** is ahead.`;
    }
    
    return {
      error: false,
      message,
      formattedPlace1,
      formattedPlace2,
      timeDiff,
      timeZone1: offset1Result.timeZoneName,
      timeZone2: offset2Result.timeZoneName
    };
  },
  
  /**
   * Formats a time zone for display.
   * @param {Object} offsetResult - The offset result from getUtcOffset.
   * @returns {string} The formatted time zone string.
   */
  formatTimeZone(offsetResult) {
    const sign = offsetResult.offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offsetResult.offset);
    const hours = Math.floor(absOffset);
    const minutes = Math.round((absOffset - hours) * 60);
    
    const formattedOffset = `UTC${sign}${hours}${minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : ''}`;
    return `${formattedOffset} (${offsetResult.timeZoneName})`;
  },
  
  /**
   * Formats a time difference for display.
   * @param {number} timeDiff - The time difference in hours.
   * @returns {string} The formatted time difference string.
   */
  formatTimeDifference(timeDiff) {
    const hours = Math.floor(timeDiff);
    const minutes = Math.round((timeDiff - hours) * 60);
    
    if (minutes === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      return `${hours} hour${hours !== 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
  }
};