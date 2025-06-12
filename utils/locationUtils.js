const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const NodeCache = require('node-cache');
const config = require('../config');

/** @type {NodeCache} Cache for storing geocoding and timezone results */
const LOC_CACHE = new NodeCache({ stdTTL: 3600 });

/** @type {Map<string, number[]>} Map to track API rate limits */
const LOC_RATE_LIMIT_COUNTS = new Map();

/**
 * Retrieves geocoding information for a location
 * @param {string} location - The location to geocode
 * @throws {Error} If geocoding fails or rate limit is exceeded
 * @returns {Promise<Object>} Geocoding result from Google Maps API
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
 * Retrieves timezone information for given coordinates
 * @param {number} lat - Latitude (-90 to 90)
 * @param {number} lng - Longitude (-180 to 180)
 * @throws {Error} If coordinates are invalid or timezone lookup fails
 * @returns {Promise<Object>} Timezone information
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
 * Checks if a rate limit has been exceeded
 * @param {string} type - The type of API request
 * @throws {Error} If rate limit is exceeded
 * @returns {Promise<void>}
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
 * Converts seconds to hours
 * @param {number} seconds - Number of seconds to convert
 * @returns {number} Equivalent number of hours
 */
function secondsToHours(seconds) {
    return seconds / 3600;
}

/**
 * Gets UTC offset for a location
 * @param {string} location - The location to get UTC offset for
 * @returns {Promise<{offset: number, timeZoneName: string, error: boolean}|{error: boolean, errorType: string}>}
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
 * Formats a place name by taking the first part before any comma
 * @param {string} place - The place name to format
 * @returns {string} Formatted place name
 */
function formatPlaceName(place) {
    return place.split(',')[0].trim();
}

/**
 * Formats an error message based on the error type
 * @param {string} place - The place that caused the error
 * @param {string} errorType - The type of error that occurred
 * @returns {string} Formatted error message
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
 * Gets geocoding data for a place
 * @param {string} place - The place to geocode
 * @returns {Promise<{error: boolean, location?: Object, formattedAddress?: string, type?: string}>}
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
 * Gets timezone data for a location
 * @param {{lat: number, lng: number}} location - The location coordinates
 * @returns {Promise<{error: boolean, timezoneId?: string, type?: string}>}
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
 * Validates if a timezone ID is valid
 * @param {string} timezoneId - The timezone ID to validate
 * @returns {boolean} True if the timezone ID is valid
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
