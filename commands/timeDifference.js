const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { getUtcOffset, formatPlaceName, formatErrorMessage } = require('../utils/locationUtils');

/**
 * Module for the /timedifference command.
 * This command calculates the time difference between two places by retrieving their UTC offsets from the Google API.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('timedifference')
    .setDescription('Get the time difference between two places.')
    .addStringOption(option =>
      option
        .setName('place1')
        .setDescription('What is the first place? (e.g., Tokyo, London, New York)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('place2')
        .setDescription('What is the second place? (e.g., Tokyo, London, New York)')
        .setRequired(true)
    ),
    
  /**
   * Executes the /timedifference command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // We check if the Google API key is configured before proceeding.
      if (!this.validateConfiguration()) {
        return await interaction.reply({ 
          content: '⚠️ Google API key is not configured. This command is currently unavailable.',
          ephemeral: true
        });
      }
      
      // We defer the reply to allow time for API requests and processing.
      await interaction.deferReply();
      
      const place1 = interaction.options.getString('place1');
      const place2 = interaction.options.getString('place2');
      
      logger.info("Time difference command initiated.", {
        userId: interaction.user.id,
        place1,
        place2
      });

      // We get the time difference information between the two places.
      const timeDiffResult = await this.calculateTimeDifference(place1, place2);
      
      if (timeDiffResult.error) {
        return await interaction.editReply({
          content: timeDiffResult.message,
          ephemeral: true
        });
      }
      
      // We create and send the reply message with the time difference information.
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
        content: '⚠️ An unexpected error occurred. Please try again later.',
        ephemeral: true
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
   * Calculates the time difference between two places using their UTC offsets.
   * @param {string} place1 - The first place name.
   * @param {string} place2 - The second place name.
   * @returns {Promise<Object>} The time difference result with formatted message.
   */
  async calculateTimeDifference(place1, place2) {
    // We retrieve UTC offsets for both places in parallel for efficiency.
    const [offset1Result, offset2Result] = await Promise.all([
      getUtcOffset(place1),
      getUtcOffset(place2)
    ]);
    
    // We handle specific errors for each place and provide helpful error messages.
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

    // We format the place names (trim and capitalize first letter) for consistent display.
    const formattedPlace1 = formatPlaceName(place1);
    const formattedPlace2 = formatPlaceName(place2);
    
    // We calculate the time difference, preserving the sign to determine which place is ahead.
    const rawTimeDiff = offset1Result.offset - offset2Result.offset;
    const timeDiff = Math.abs(rawTimeDiff);
    
    // We determine which place is ahead based on the sign of the time difference.
    const aheadPlace = rawTimeDiff > 0 ? formattedPlace1 : 
                      rawTimeDiff < 0 ? formattedPlace2 : null;
    
    // We format the time difference for human-readable display.
    const formattedTimeDiff = this.formatTimeDifference(timeDiff);
    
    // We create a comprehensive response message with all the time information.
    let message = `⏳ **Time Difference Information:**\n\n`;
    
    // We add time zone information for both places.
    message += `• **${formattedPlace1}**: ${this.formatTimeZone(offset1Result)}\n`;
    message += `• **${formattedPlace2}**: ${this.formatTimeZone(offset2Result)}\n\n`;
    
    // We add the time difference with appropriate wording based on whether they're in the same zone.
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
   * Formats a time zone for display with UTC offset and time zone name.
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
   * Formats a time difference for display with appropriate pluralization.
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