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
    
    let count = LOC_RATE_LIMIT_COUNTS.get(type) || 0;
    count = count.filter(timestamp => timestamp > windowStart).length;
    
    if (count >= 50) {
        throw new Error("Rate limit exceeded. Please try again later.");
    }
    
    if (!LOC_RATE_LIMIT_COUNTS.has(type)) {
        LOC_RATE_LIMIT_COUNTS.set(type, []);
    }
    
    LOC_RATE_LIMIT_COUNTS.get(type).push(now);
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

module.exports = {
    getGeocodingInfo,
    getTimezoneInfo,
    secondsToHours
};
