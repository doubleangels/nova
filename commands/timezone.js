/**
 * Timezone Command Module
 * 
 * This module implements a Discord slash command that allows users to set their timezone
 * for use with the bot's time conversion features. It uses Google's Geocoding and Timezone APIs
 * to convert a location name to a valid IANA timezone identifier. Administrators can also set
 * timezones for other users.
 * 
 * @module commands/timezone
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const { DateTime } = require('luxon');
const logger = require('../logger.js')(path.basename(__filename));
const { setUserTimezone } = require('../utils/database.js');
const axios = require('axios');
const config = require('../config');

// Configuration constants.
const COMMAND_CONFIG = {
  NAME: 'timezone',
  DESCRIPTION: 'Sets your timezone for use in auto-timezone features.',
  OPTIONS: {
    PLACE: {
      NAME: 'place',
      DESCRIPTION: 'What place do you want to use for timezone? (e.g., Tokyo, London, New York)'
    },
    USER: {
      NAME: 'user',
      DESCRIPTION: 'What user do you want to set the timezone for?'
    }
  },
  RESPONSES: {
    SUCCESS_SELF: '✅ Your timezone has been successfully set to: `%s` based on location: %s',
    SUCCESS_OTHER: '✅ You have set %s\'s timezone to: `%s` based on location: %s',
    MISSING_PERMISSION: '⚠️ You do not have permission to set timezones for other users.',
    GEOCODING_ERROR: '⚠️ Could not find the location \'%s\'. Please check spelling and try again.',
    TIMEZONE_ERROR: '⚠️ Error retrieving timezone information for \'%s\'.',
    INVALID_TIMEZONE: '⚠️ The timezone identifier returned (%s) is not valid. Please try a different location.',
    GENERAL_ERROR: '⚠️ An unexpected error occurred. Please try again later.',
    API_ERROR_GEOCODING: '⚠️ Google Geocoding API error. Try again later.',
    API_ERROR_TIMEZONE: '⚠️ Google Time Zone API error. Try again later.',
    API_KEY_MISSING: '⚠️ Google API key is not configured. This command is currently unavailable.'
  },
  API: {
    GEOCODING_URL: 'https://maps.googleapis.com/maps/api/geocode/json',
    TIMEZONE_URL: 'https://maps.googleapis.com/maps/api/timezone/json'
  }
};

/**
 * Validates if a timezone identifier is valid using Luxon.
 * 
 * This function checks if the provided string is a valid IANA timezone identifier
 * by attempting to create a DateTime object with the timezone and checking its validity.
 * 
 * @param {string} tz - The timezone identifier to validate.
 * @returns {boolean} True if the timezone is valid, false otherwise.
 */
const isValidTimezone = (tz) => {
    // Check if the input is a non-empty string.
    if (typeof tz !== 'string' || tz.trim() === '') {
        return false;
    }
    
    // Try to create a DateTime object with the timezone.
    const dt = DateTime.local().setZone(tz);
    
    // Check if the DateTime object is valid.
    return dt.isValid && dt.invalidReason === null;
};

/**
 * Removes API keys from URLs for safe logging.
 * 
 * @param {string} url - The URL that may contain sensitive information.
 * @returns {string} The sanitized URL.
 */
function safeUrl(url) {
    return url.replace(/key=([^&]+)/, 'key=REDACTED');
}

/**
 * Fetches geocoding data for a given place name.
 * 
 * @param {string} place - The place name to geocode.
 * @returns {Promise<Object>} An object containing geocoding results or error information.
 */
async function getGeocodingData(place) {
    try {
        // Build the Geocoding API URL.
        const geocodeParams = new URLSearchParams({
            address: place,
            key: config.googleApiKey
        });
        
        const geocodeRequestUrl = `${COMMAND_CONFIG.API.GEOCODING_URL}?${geocodeParams.toString()}`;
        
        logger.debug("Fetching geocoding data.", {
            place,
            requestUrl: safeUrl(geocodeRequestUrl)
        });
        
        // Fetch geocoding data using axios.
        const response = await axios.get(geocodeRequestUrl);
        
        if (response.status !== 200) {
            logger.warn("Google Geocoding API returned non-200 status.", { 
                status: response.status,
                place
            });
            
            return { error: true, type: 'api_error' };
        }
        
        const geoData = response.data;
        
        if (!geoData.results || geoData.results.length === 0) {
            logger.warn("No geocoding results found.", { place });
            return { error: true, type: 'not_found' };
        }
        
        const formattedAddress = geoData.results[0].formatted_address;
        const location = geoData.results[0].geometry.location;
        
        logger.debug("Successfully retrieved coordinates.", {
            place,
            address: formattedAddress,
            lat: location.lat,
            lng: location.lng
        });
        
        return {
            error: false,
            location: location,
            formattedAddress: formattedAddress
        };
        
    } catch (error) {
        logger.error("Error fetching geocoding data.", {
            place,
            error: error.message,
            stack: error.stack
        });
        
        return { error: true, type: 'exception' };
    }
}

/**
 * Fetches timezone data for given coordinates.
 * 
 * @param {Object} location - The location object with lat and lng properties.
 * @returns {Promise<Object>} An object containing timezone results or error information.
 */
async function getTimezoneData(location) {
    try {
        // Generate current timestamp for the timezone request.
        const timestamp = Math.floor(Date.now() / 1000);
        
        // Build the Timezone API URL.
        const timezoneParams = new URLSearchParams({
            location: `${location.lat},${location.lng}`,
            timestamp: timestamp.toString(),
            key: config.googleApiKey
        });
        
        const timezoneRequestUrl = `${COMMAND_CONFIG.API.TIMEZONE_URL}?${timezoneParams.toString()}`;
        
        logger.debug("Fetching timezone data.", {
            lat: location.lat,
            lng: location.lng,
            requestUrl: safeUrl(timezoneRequestUrl)
        });
        
        // Fetch timezone data using axios.
        const response = await axios.get(timezoneRequestUrl);
        
        if (response.status !== 200) {
            logger.warn("Google Timezone API returned non-200 status.", { 
                status: response.status,
                lat: location.lat,
                lng: location.lng 
            });
            
            return { error: true, type: 'api_error' };
        }
        
        const tzData = response.data;
        
        if (tzData.status !== "OK") {
            logger.warn("Error retrieving timezone info.", {
                status: tzData.status,
                lat: location.lat,
                lng: location.lng
            });
            
            return { error: true, type: 'invalid_response' };
        }
        
        logger.debug("Successfully retrieved timezone data.", {
            timezoneId: tzData.timeZoneId,
            timezoneName: tzData.timeZoneName
        });
        
        return {
            error: false,
            timezoneId: tzData.timeZoneId
        };
        
    } catch (error) {
        logger.error("Error fetching timezone data.", {
            lat: location.lat,
            lng: location.lng,
            error: error.message,
            stack: error.stack
        });
        
        return { error: true, type: 'exception' };
    }
}

module.exports = {
    // Define the slash command using Discord.js builder.
    data: new SlashCommandBuilder()
        .setName(COMMAND_CONFIG.NAME)
        .setDescription(COMMAND_CONFIG.DESCRIPTION)
        .addStringOption(option =>
            option.setName(COMMAND_CONFIG.OPTIONS.PLACE.NAME)
                .setDescription(COMMAND_CONFIG.OPTIONS.PLACE.DESCRIPTION)
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName(COMMAND_CONFIG.OPTIONS.USER.NAME)
                .setDescription(COMMAND_CONFIG.OPTIONS.USER.DESCRIPTION)
                .setRequired(false)
        ),
    
    /**
     * Executes the timezone command, setting a user's timezone based on a location name.
     * 
     * This function handles the timezone command execution flow:
     * 1. Validates permissions if setting timezone for another user.
     * 2. Geocodes the provided place name to coordinates using Google's Geocoding API.
     * 3. Converts the coordinates to a timezone using Google's Timezone API.
     * 4. Validates the timezone and stores it in the database.
     * 5. Responds to the user with confirmation.
     * 
     * @param {Interaction} interaction - The Discord interaction object.
     * @returns {Promise<void>}
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
            
            // Defer the reply to give time for API calls to complete.
            await interaction.deferReply({ ephemeral: true });
            
            // Get command options.
            const place = interaction.options.getString(COMMAND_CONFIG.OPTIONS.PLACE.NAME, true).trim();
            const targetUser = interaction.options.getUser(COMMAND_CONFIG.OPTIONS.USER.NAME);
            const isAdminAction = targetUser !== null;
            
            // Check permissions if setting timezone for another user.
            if (isAdminAction) {
                const member = interaction.member;
                const hasPermission = member.permissions.has(PermissionFlagsBits.Administrator);
                
                if (!hasPermission) {
                    logger.warn("Unauthorized timezone set attempt for another user.", {
                        userId: interaction.user.id,
                        userTag: interaction.user.tag,
                        targetUserId: targetUser.id,
                        targetUserTag: targetUser.tag
                    });
                    
                    await interaction.editReply({
                        content: COMMAND_CONFIG.RESPONSES.MISSING_PERMISSION
                    });
                    return;
                }
            }
            
            // Determine the target user ID and tag.
            const memberId = isAdminAction ? targetUser.id : interaction.user.id;
            const memberTag = isAdminAction ? targetUser.tag : interaction.user.tag;
            
            logger.info("Timezone command initiated.", {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                targetUserId: memberId,
                targetUserTag: memberTag,
                place: place
            });
            
            // Step 1: Geocode the place name to coordinates.
            const geocodeResult = await getGeocodingData(place);
            
            if (geocodeResult.error) {
                let errorMessage;
                
                if (geocodeResult.type === 'not_found') {
                    errorMessage = COMMAND_CONFIG.RESPONSES.GEOCODING_ERROR.replace('%s', place);
                } else {
                    errorMessage = COMMAND_CONFIG.RESPONSES.API_ERROR_GEOCODING;
                }
                
                await interaction.editReply({ content: errorMessage });
                return;
            }
            
            const { location, formattedAddress } = geocodeResult;
            
            // Step 2: Get the timezone for the coordinates.
            const timezoneResult = await getTimezoneData(location);
            
            if (timezoneResult.error) {
                let errorMessage;
                
                if (timezoneResult.type === 'invalid_response') {
                    errorMessage = COMMAND_CONFIG.RESPONSES.TIMEZONE_ERROR.replace('%s', place);
                } else {
                    errorMessage = COMMAND_CONFIG.RESPONSES.API_ERROR_TIMEZONE;
                }
                
                await interaction.editReply({ content: errorMessage });
                return;
            }
            
            const { timezoneId } = timezoneResult;
            
            // Step 3: Validate the timezone identifier.
            if (!isValidTimezone(timezoneId)) {
                logger.warn("Invalid timezone identifier returned by API.", {
                    timezoneId,
                    place,
                    targetUserId: memberId
                });
                
                await interaction.editReply({
                    content: COMMAND_CONFIG.RESPONSES.INVALID_TIMEZONE.replace('%s', timezoneId)
                });
                return;
            }
            
            // Step 4: Store the timezone in the database.
            await setUserTimezone(memberId, timezoneId);
            
            logger.info("Timezone set successfully.", {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                targetUserId: memberId,
                targetUserTag: memberTag,
                timezoneId,
                place
            });
            
            // Step 5: Send confirmation message.
            let responseMessage;
            
            if (isAdminAction) {
                responseMessage = COMMAND_CONFIG.RESPONSES.SUCCESS_OTHER
                    .replace('%s', targetUser)
                    .replace('%s', timezoneId)
                    .replace('%s', formattedAddress);
            } else {
                responseMessage = COMMAND_CONFIG.RESPONSES.SUCCESS_SELF
                    .replace('%s', timezoneId)
                    .replace('%s', formattedAddress);
            }
            
            await interaction.editReply({ content: responseMessage });
            
        } catch (error) {
            // Handle any unexpected errors.
            logger.error("Error executing timezone command.", {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                userTag: interaction.user.tag
            });
            
            await interaction.editReply({
                content: COMMAND_CONFIG.RESPONSES.GENERAL_ERROR
            });
        }
    }
};
