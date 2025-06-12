/**
 * Location utilities module for handling geocoding and timezone operations.
 * Manages location-based functionality and caching.
 * @module utils/locationUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const NodeCache = require('node-cache');
const config = require('../config');

const LOC_CACHE = new NodeCache({ stdTTL: 3600 });
const LOC_RATE_LIMIT_COUNTS = new Map();

/**
 * Gets geocoding information for a location.
 * @async
 * @function getGeocodingInfo
 * @param {string} location - The location to get geocoding info for
 * @returns {Promise<Object>} Geocoding information
 * @throws {Error} If geocoding fails
 */
async function getGeocodingInfo(location) {
    try {
        const cacheKey = `geocode_${location}`;
        const cachedResult = LOC_CACHE.get(cacheKey);
        
        if (cachedResult) {
            logger.debug("Using cached geocoding result:", { location });
            return cachedResult;
        }

        await checkRateLimit('geocoding');
        
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                address: location,
                key: config.googleApiKey
            },
            timeout: 5000
        });

        if (response.data.status !== 'OK') {
            throw new Error(`Geocoding failed: ${response.data.status}`);
        }

        const result = response.data.results[0];
        LOC_CACHE.set(cacheKey, result);
        
        return result;
    } catch (error) {
        logger.error("Error getting geocoding info:", { error: error.message, location });
        throw error;
    }
}

/**
 * Gets timezone information for coordinates.
 * @async
 * @function getTimezoneInfo
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object>} Timezone information
 * @throws {Error} If timezone lookup fails
 */
async function getTimezoneInfo(lat, lng) {
    try {
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new Error("Invalid coordinates provided");
        }

        const cacheKey = `timezone_${lat}_${lng}`;
        const cachedResult = LOC_CACHE.get(cacheKey);
        
        if (cachedResult) {
            logger.debug("Using cached timezone result:", { lat, lng });
            return cachedResult;
        }

        await checkRateLimit('timezone');
        
        const timestamp = Math.floor(Date.now() / 1000);
        const response = await axios.get('https://maps.googleapis.com/maps/api/timezone/json', {
            params: {
                location: `${lat},${lng}`,
                timestamp,
                key: config.googleApiKey
            },
            timeout: 5000
        });

        if (response.data.status !== 'OK') {
            throw new Error(`Timezone lookup failed: ${response.data.status}`);
        }

        const result = {
            timeZoneId: response.data.timeZoneId,
            timeZoneName: response.data.timeZoneName,
            rawOffset: response.data.rawOffset,
            dstOffset: response.data.dstOffset
        };

        LOC_CACHE.set(cacheKey, result);
        
        return result;
    } catch (error) {
        logger.error("Error getting timezone info:", { error: error.message, lat, lng });
        throw error;
    }
}

/**
 * Checks if a request is within rate limits.
 * @async
 * @function checkRateLimit
 * @param {string} type - The type of request
 * @throws {Error} If rate limit is exceeded
 */
async function checkRateLimit(type) {
    const now = Date.now();
    const windowStart = now - 60000;
    
    if (!LOC_RATE_LIMIT_COUNTS.has(type)) {
        LOC_RATE_LIMIT_COUNTS.set(type, []);
    }
    
    const timestamps = LOC_RATE_LIMIT_COUNTS.get(type);
    const recentRequests = timestamps.filter(timestamp => timestamp > windowStart);
    
    if (recentRequests.length >= 50) {
        throw new Error("Rate limit exceeded. Please try again later.");
    }
    
    timestamps.push(now);
}

/**
 * Converts seconds to hours.
 * @function secondsToHours
 * @param {number} seconds - Number of seconds
 * @returns {number} Number of hours
 */
function secondsToHours(seconds) {
    return seconds / 3600;
}

/**
 * Gets the UTC offset for a location.
 * @async
 * @function getUtcOffset
 * @param {string} location - The location to get UTC offset for
 * @returns {Promise<Object>} UTC offset information
 * @throws {Error} If UTC offset lookup fails
 */
async function getUtcOffset(location) {
    try {
        const geocodingInfo = await getGeocodingInfo(location);
        const { lat, lng } = geocodingInfo.geometry.location;
        const timezoneInfo = await getTimezoneInfo(lat, lng);
        
        const totalOffset = secondsToHours(timezoneInfo.rawOffset + timezoneInfo.dstOffset);
        
        return {
            offset: totalOffset,
            timeZoneName: timezoneInfo.timeZoneName,
            error: false
        };
    } catch (error) {
        logger.error("Error getting UTC offset:", { error: error.message, location });
        return {
            error: true,
            errorType: error.message
        };
    }
}

/**
 * Formats a place name for display.
 * @function formatPlaceName
 * @param {string} place - The place name to format
 * @returns {string} The formatted place name
 */
function formatPlaceName(place) {
    return place.split(',')[0].trim();
}

/**
 * Formats an error message for display.
 * @function formatErrorMessage
 * @param {string} place - The place that caused the error
 * @param {string} errorType - The type of error
 * @returns {string} The formatted error message
 */
function formatErrorMessage(place, errorType) {
    if (errorType.includes('ZERO_RESULTS')) {
        return `⚠️ Could not find location: ${place}`;
    } else if (errorType.includes('OVER_QUERY_LIMIT')) {
        return '⚠️ Too many requests. Please try again later.';
    } else if (errorType.includes('REQUEST_DENIED')) {
        return '⚠️ API access denied. Please check API configuration.';
    } else if (errorType.includes('INVALID_REQUEST')) {
        return `⚠️ Invalid location: ${place}`;
    } else {
        return `⚠️ Failed to get timezone information for ${place}`;
    }
}

/**
 * Gets geocoding data for a location.
 * @async
 * @function getGeocodingData
 * @param {string} place - The place to get geocoding data for
 * @returns {Promise<Object>} Geocoding data with location and formatted address
 */
async function getGeocodingData(place) {
    try {
        const geocodingInfo = await getGeocodingInfo(place);
        return {
            error: false,
            location: geocodingInfo.geometry.location,
            formattedAddress: geocodingInfo.formatted_address
        };
    } catch (error) {
        logger.error("Error getting geocoding data:", { error: error.message, place });
        return {
            error: true,
            type: error.message
        };
    }
}

/**
 * Gets timezone data for coordinates.
 * @async
 * @function getTimezoneData
 * @param {Object} location - The location object with lat and lng
 * @returns {Promise<Object>} Timezone data with timezone ID
 */
async function getTimezoneData(location) {
    try {
        const timezoneInfo = await getTimezoneInfo(location.lat, location.lng);
        return {
            error: false,
            timezoneId: timezoneInfo.timeZoneId
        };
    } catch (error) {
        logger.error("Error getting timezone data:", { error: error.message, location });
        return {
            error: true,
            type: error.message
        };
    }
}

/**
 * Validates if a timezone identifier is valid.
 * @function isValidTimezone
 * @param {string} timezoneId - The timezone identifier to validate
 * @returns {boolean} True if the timezone is valid
 */
function isValidTimezone(timezoneId) {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezoneId });
        return true;
    } catch (error) {
        return false;
    }
}

module.exports = {
    getGeocodingInfo,
    getTimezoneInfo,
    secondsToHours,
    getUtcOffset,
    formatPlaceName,
    formatErrorMessage,
    getGeocodingData,
    getTimezoneData,
    isValidTimezone
};
