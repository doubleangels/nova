const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { getUtcOffset, formatPlaceName, formatErrorMessage } = require('../utils/locationUtils');

/**
 * Command module for calculating time differences between locations.
 * Uses Google Maps API to determine timezone information.
 * @type {Object}
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
   * Executes the timeDifference command.
   * This function:
   * 1. Validates API configuration
   * 2. Gets timezone information for both places
   * 3. Calculates and displays time difference
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error calculating time difference
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({ 
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          ephemeral: true
        });
      }
      
      await interaction.deferReply();
      
      const place1 = interaction.options.getString('place1');
      const place2 = interaction.options.getString('place2');
      
      logger.info("/timedifference command initiated:", {
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
      logger.info("/timedifference command completed successfully:", {
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
   * Validates that required Google API configuration is present.
   * 
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
   * Calculates the time difference between two places.
   * 
   * @param {string} place1 - The first place name
   * @param {string} place2 - The second place name
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @returns {Promise<Object>} Object containing time difference information and message
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
        .setColor(0xc03728)
        .setTitle('⏳ Time Difference Information')
        .addFields(
          { name: formattedPlace1, value: this.formatTimeZone(offset1Result) },
          { name: formattedPlace2, value: this.formatTimeZone(offset2Result) }
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
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
   * Formats timezone information for display.
   * 
   * @param {Object} offsetResult - The timezone offset result
   * @returns {string} Formatted timezone string
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
   * Formats time difference for display.
   * 
   * @param {number} timeDiff - The time difference in hours
   * @returns {string} Formatted time difference string
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
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in timedifference command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while calculating time difference.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to retrieve timezone information. Please try again later.";
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = "⚠️ The request timed out. Please try again.";
    } else if (error.response?.status === 403) {
      errorMessage = "⚠️ API access denied. Please check API configuration.";
    } else if (error.response?.status === 429) {
      errorMessage = "⚠️ Too many requests. Please try again later.";
    } else if (error.response?.status >= 500) {
      errorMessage = "⚠️ Failed to retrieve timezone information. Please try again later.";
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
      }).catch(() => {});
    }
  }
};