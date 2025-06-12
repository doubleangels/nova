const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const NodeCache = require('node-cache');
const config = require('../config');

const LOC_CACHE = new NodeCache({ stdTTL: 3600 });
const LOC_RATE_LIMIT_COUNTS = new Map();

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

function secondsToHours(seconds) {
    return seconds / 3600;
}

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

function formatPlaceName(place) {
    return place.split(',')[0].trim();
}

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
