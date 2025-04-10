const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'timedifference',
  DESCRIPTION: 'Get the time difference between two places.',
  OPTIONS: {
    PLACE1: {
      NAME: 'place1',
      DESCRIPTION: 'Enter the first city name (e.g., New York)'
    },
    PLACE2: {
      NAME: 'place2',
      DESCRIPTION: 'Enter the second city name (e.g., London)'
    }
  },
  RESPONSES: {
    SUCCESS: '⏳ The time difference between **%s** and **%s** is **%s hours**.',
    GEOCODING_FAILED: '⚠️ Could not find location "%s". Please provide a valid city name.',
    TIMEZONE_FAILED: '⚠️ Could not determine timezone for "%s". Please try a different city.',
    GENERAL_ERROR: '⚠️ An unexpected error occurred. Please try again later.',
    API_KEY_MISSING: '⚠️ Google API key is not configured. This command is currently unavailable.'
  },
  API: {
    GEOCODING_URL: 'https://maps.googleapis.com/maps/api/geocode/json',
    TIMEZONE_URL: 'https://maps.googleapis.com/maps/api/timezone/json'
  }
};

/**
 * Module for the /timedifference command.
 * Calculates the time difference between two places by retrieving their UTC offsets
 * using the Google Geocoding and Timezone APIs.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_CONFIG.NAME)
    .setDescription(COMMAND_CONFIG.DESCRIPTION)
    .addStringOption(option =>
      option
        .setName(COMMAND_CONFIG.OPTIONS.PLACE1.NAME)
        .setDescription(COMMAND_CONFIG.OPTIONS.PLACE1.DESCRIPTION)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName(COMMAND_CONFIG.OPTIONS.PLACE2.NAME)
        .setDescription(COMMAND_CONFIG.OPTIONS.PLACE2.DESCRIPTION)
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
          command: COMMAND_CONFIG.NAME,
          userId: interaction.user.id
        });
        
        await interaction.reply({ 
          content: COMMAND_CONFIG.RESPONSES.API_KEY_MISSING, 
          ephemeral: true 
        });
        return;
      }
      
      // Defer reply to allow time for processing.
      await interaction.deferReply();
      
      const place1 = interaction.options.getString(COMMAND_CONFIG.OPTIONS.PLACE1.NAME);
      const place2 = interaction.options.getString(COMMAND_CONFIG.OPTIONS.PLACE2.NAME);
      
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
      const message = COMMAND_CONFIG.RESPONSES.SUCCESS
        .replace('%s', formattedPlace1)
        .replace('%s', formattedPlace2)
        .replace('%s', timeDiff);
        
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
        content: COMMAND_CONFIG.RESPONSES.GENERAL_ERROR,
        ephemeral: true
      });
    }
  }
};

/**
 * Retrieves the UTC offset for a given city using Google Geocoding and Timezone APIs.
 * @param {string} city - The name of the city.
 * @returns {Promise<Object>} An object with either the offset or error information.
 */
async function getUtcOffset(city) {
  try {
    // Build the Geocoding API URL.
    const geocodeParams = new URLSearchParams({
      address: city,
      key: config.googleApiKey
    });
    
    const geocodeRequestUrl = `${COMMAND_CONFIG.API.GEOCODING_URL}?${geocodeParams.toString()}`;
    
    logger.debug("Fetching geocoding data.", {
      city,
      requestUrl: safeUrl(geocodeRequestUrl)
    });
    
    // Fetch geocoding data using axios.
    const geocodeResponse = await axios.get(geocodeRequestUrl);
    const geoData = geocodeResponse.data;

    if (!geoData.results || geoData.results.length === 0) {
      logger.debug("Geocoding lookup failed.", {
        city,
        status: geoData.status
      });
      
      return {
        error: true,
        errorType: 'geocoding'
      };
    }
    
    const location = geoData.results[0].geometry.location;
    const { lat, lng } = location;
    const timestamp = dayjs().unix();
    
    logger.debug("Geocoding success.", {
      city,
      lat,
      lng
    });

    // Build the Timezone API URL.
    const timezoneParams = new URLSearchParams({
      location: `${lat},${lng}`,
      timestamp: timestamp.toString(),
      key: config.googleApiKey
    });
    
    const timezoneRequestUrl = `${COMMAND_CONFIG.API.TIMEZONE_URL}?${timezoneParams.toString()}`;
    
    logger.debug("Fetching timezone data.", {
      city,
      requestUrl: safeUrl(timezoneRequestUrl)
    });
    
    // Fetch timezone data using axios.
    const timezoneResponse = await axios.get(timezoneRequestUrl);
    const tzData = timezoneResponse.data;

    if (tzData.status !== "OK") {
      logger.warn("Timezone lookup failed.", {
        city,
        status: tzData.status
      });
      
      return {
        error: true,
        errorType: 'timezone'
      };
    }
    
    // Convert seconds to hours.
    const rawOffset = tzData.rawOffset / 3600;
    const dstOffset = tzData.dstOffset / 3600;
    
    logger.debug("Timezone data retrieved successfully.", {
      city,
      rawOffset,
      dstOffset,
      totalOffset: rawOffset + dstOffset
    });
    
    return {
      error: false,
      offset: rawOffset + dstOffset
    };
    
  } catch (error) {
    logger.error("Error retrieving UTC offset.", {
      city,
      error: error.message,
      stack: error.stack
    });
    
    return {
      error: true,
      errorType: 'general'
    };
  }
}

/**
 * Formats a place name by trimming and capitalizing the first letter.
 * @param {string} placeName - The place name to format.
 * @returns {string} The formatted place name.
 */
function formatPlaceName(placeName) {
  if (!placeName || typeof placeName !== 'string') return '';
  const trimmed = placeName.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Formats an error message based on the error type.
 * @param {string} place - The place name that caused the error.
 * @param {string} errorType - The type of error that occurred.
 * @returns {string} The formatted error message.
 */
function formatErrorMessage(place, errorType) {
  switch (errorType) {
    case 'geocoding':
      return COMMAND_CONFIG.RESPONSES.GEOCODING_FAILED.replace('%s', place);
    case 'timezone':
      return COMMAND_CONFIG.RESPONSES.TIMEZONE_FAILED.replace('%s', place);
    default:
      return COMMAND_CONFIG.RESPONSES.GENERAL_ERROR;
  }
}

/**
 * Removes API keys from URLs for safe logging.
 * @param {string} url - The URL that may contain sensitive information.
 * @returns {string} The sanitized URL.
 */
function safeUrl(url) {
  return url.replace(/key=([^&]+)/, 'key=REDACTED');
}
