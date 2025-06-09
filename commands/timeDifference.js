/**
 * Time difference command module for calculating time differences between locations.
 * Handles Google API interactions, time zone calculations, and result formatting.
 * @module commands/timeDifference
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { getUtcOffset, formatPlaceName, formatErrorMessage } = require('../utils/locationUtils');
const { logError } = require('../errors');

const TIME_API_TIMEOUT = 10000;

const TIME_EMBED_COLOR = '#cd41ff';
const TIME_EMBED_TITLE = '⏳ Time Difference Information';
const TIME_EMBED_FOOTER_PREFIX = 'Requested by';

const TIME_ERROR_CONFIG_MISSING = "⚠️ This command is not properly configured. Please contact an administrator.";
const TIME_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while calculating time difference.";
const TIME_ERROR_API = "⚠️ Failed to retrieve timezone information. Please try again later.";
const TIME_ERROR_RATE_LIMIT = "⚠️ API rate limit reached. Please try again in a few moments.";
const TIME_ERROR_NETWORK = "⚠️ Network error occurred. Please check your internet connection.";
const TIME_ERROR_ACCESS_DENIED = "⚠️ API access denied. Please check API configuration.";
const TIME_ERROR_REQUEST_TIMEOUT = "⚠️ The request timed out. Please try again.";
const TIME_ERROR_RATE_LIMIT_EXCEEDED = "⚠️ Too many requests. Please try again later.";
const TIME_ERROR_INVALID_LOCATION = "⚠️ Invalid location specified.";
const TIME_ERROR_LOCATION_NOT_FOUND = "⚠️ Could not find the specified location.";
const TIME_ERROR_TIMEZONE_NOT_FOUND = "⚠️ Could not determine timezone for the specified location.";

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
   * Executes the time difference command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the time difference calculation fails
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({ 
          content: TIME_ERROR_CONFIG_MISSING,
          ephemeral: true
        });
      }
      
      await interaction.deferReply();
      
      const place1 = interaction.options.getString('place1');
      const place2 = interaction.options.getString('place2');
      
      logger.info("/timediff command initiated:", {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const timeDiffResult = await this.calculateTimeDifference(place1, place2, interaction);
      
      if (timeDiffResult.error) {
        return await interaction.editReply({
          content: timeDiffResult.message,
          ephemeral: true
        });
      }
      
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
   * Validates that the required configuration is available.
   * @function validateConfiguration
   * @returns {boolean} True if configuration is valid, false otherwise
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
   * @async
   * @function calculateTimeDifference
   * @param {string} place1 - The first place name
   * @param {string} place2 - The second place name
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @returns {Promise<Object>} The time difference result with formatted message
   */
  async calculateTimeDifference(place1, place2, interaction) {
    try {
      const [offset1Result, offset2Result] = await Promise.all([
        getUtcOffset(place1),
        getUtcOffset(place2)
      ]);
      
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

      const formattedPlace1 = formatPlaceName(place1);
      const formattedPlace2 = formatPlaceName(place2);
      
      const rawTimeDiff = offset1Result.offset - offset2Result.offset;
      const timeDiff = Math.abs(rawTimeDiff);
      
      const aheadPlace = rawTimeDiff > 0 ? formattedPlace1 : 
                        rawTimeDiff < 0 ? formattedPlace2 : null;
      
      const formattedTimeDiff = this.formatTimeDifference(timeDiff);
      
      const embed = new EmbedBuilder()
        .setColor(TIME_EMBED_COLOR)
        .setTitle(TIME_EMBED_TITLE)
        .addFields(
          { name: formattedPlace1, value: this.formatTimeZone(offset1Result) },
          { name: formattedPlace2, value: this.formatTimeZone(offset2Result) }
        )
        .setFooter({ text: `${TIME_EMBED_FOOTER_PREFIX} ${interaction.user.tag}` })
        .setTimestamp();

      if (rawTimeDiff === 0) {
        embed.setDescription(`**${formattedPlace1}** and **${formattedPlace2}** are in the same time zone.`);
      } else {
        embed.setDescription(`The time difference is **${formattedTimeDiff}**.\n**${aheadPlace}** is ahead.`);
      }
      
      return {
        error: false,
        message: { embeds: [embed] },
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
   * Formats a time zone for display with UTC offset and time zone name.
   * @function formatTimeZone
   * @param {Object} offsetResult - The offset result from getUtcOffset
   * @returns {string} The formatted time zone string
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
   * @function formatTimeDifference
   * @param {number} timeDiff - The time difference in hours
   * @returns {string} The formatted time difference string
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
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'timedifference', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = TIME_ERROR_UNEXPECTED;
    
    if (error.message === TIME_ERROR_API) {
      errorMessage = TIME_ERROR_API;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = TIME_ERROR_REQUEST_TIMEOUT;
    } else if (error.response?.status === 403) {
      errorMessage = TIME_ERROR_ACCESS_DENIED;
    } else if (error.response?.status === 429) {
      errorMessage = TIME_ERROR_RATE_LIMIT_EXCEEDED;
    } else if (error.response?.status >= 500) {
      errorMessage = TIME_ERROR_API;
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
      });
    }
  }
};