const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { getUtcOffset, formatPlaceName, formatErrorMessage } = require('../utils/locationUtils');
const { getErrorMessage, logError, ERROR_MESSAGES } = require('../errors');

/**
 * We handle the timedifference command.
 * This function allows users to calculate the time difference between two locations.
 *
 * We perform several tasks:
 * 1. We validate Google API configuration.
 * 2. We process location search requests.
 * 3. We calculate time differences between locations.
 * 4. We format and display time zone information.
 *
 * @param {Interaction} interaction - The Discord interaction object.
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
   * We execute the /timedifference command.
   * This function processes the time difference calculation and displays results.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // We check if the Google API key is configured before proceeding.
      if (!this.validateConfiguration()) {
        return await interaction.reply({ 
          content: ERROR_MESSAGES.CONFIG_MISSING,
          ephemeral: true
        });
      }
      
      // We defer the reply to allow time for API requests and processing.
      await interaction.deferReply();
      
      const place1 = interaction.options.getString('place1');
      const place2 = interaction.options.getString('place2');
      
      logger.info("/timediff command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId
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
      await this.handleError(interaction, error);
    }
  },
  
  /**
   * We validate that the required configuration is available.
   * This function checks for the presence of necessary API keys.
   *
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
   * We calculate the time difference between two places using their UTC offsets.
   * This function retrieves UTC offsets and formats the result.
   *
   * @param {string} place1 - The first place name.
   * @param {string} place2 - The second place name.
   * @returns {Promise<Object>} The time difference result with formatted message.
   */
  async calculateTimeDifference(place1, place2) {
    try {
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
    } catch (error) {
      logger.error("Error calculating time difference.", {
        error: error.message,
        place1,
        place2
      });
      throw error;
    }
  },
  
  /**
   * We format a time zone for display with UTC offset and time zone name.
   * This function creates a formatted string for a time zone.
   *
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
   * We format a time difference for display with appropriate pluralization.
   * This function creates a formatted string for a time difference.
   *
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
  },

  /**
   * We handle errors that occur during command execution.
   * This function logs the error and attempts to notify the user.
   *
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   * @param {Error} error - The error that occurred.
   */
  async handleError(interaction, error) {
    logError(error, 'timedifference', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
    
    if (error.message === "API_ERROR") {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = ERROR_MESSAGES.REQUEST_TIMEOUT;
    } else if (error.response?.status === 403) {
      errorMessage = ERROR_MESSAGES.API_ACCESS_DENIED;
    } else if (error.response?.status === 429) {
      errorMessage = ERROR_MESSAGES.RATE_LIMIT_EXCEEDED;
    } else if (error.response?.status >= 500) {
      errorMessage = ERROR_MESSAGES.API_ERROR;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for timediff command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
        // We silently catch if all error handling attempts fail.
      });
    }
  }
};