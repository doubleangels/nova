/**
 * Location utilities module for handling geocoding and timezone operations.
 * Manages Google Maps API interactions, location caching, and rate limiting.
 * @module utils/locationUtils
 */

const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { DateTime } = require('luxon');
const dayjs = require('dayjs');
const moment = require('moment-timezone');
const NodeCache = require('node-cache');

const LOC_API_GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const LOC_API_TIMEZONE_URL = 'https://maps.googleapis.com/maps/api/timezone/json';
const LOC_API_STATUS_SUCCESS = 'OK';
const LOC_API_TIMEOUT_MS = 5000;

const LOC_CACHE_TTL = 3600;
const LOC_CACHE = new NodeCache({ stdTTL: LOC_CACHE_TTL });

const LOC_RATE_LIMIT_WINDOW = 60000;
const LOC_RATE_LIMIT_MAX_REQUESTS = 50;
const LOC_RATE_LIMIT_COUNTS = new Map();

const LOC_MIN_LATITUDE = -90;
const LOC_MAX_LATITUDE = 90;
const LOC_MIN_LONGITUDE = -180;
const LOC_MAX_LONGITUDE = 180;

const LOC_SECONDS_PER_HOUR = 3600;

// Error Types
const LOC_ERROR_TYPES = {
  INVALID_INPUT: 'invalid_input',
  NOT_FOUND: 'not_found',
  API_ERROR: 'api_error',
  TIMEOUT: 'timeout',
  RATE_LIMIT: 'rate_limit',
  CACHE_ERROR: 'cache_error',
  GENERAL: 'general'
};

/**
 * Validates if the provided coordinates are within valid ranges.
 * @function isValidCoordinates
 * @param {number} lat - The latitude to validate
 * @param {number} lng - The longitude to validate
 * @returns {boolean} Whether the coordinates are valid
 */
function isValidCoordinates(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= LOC_MIN_LATITUDE &&
    lat <= LOC_MAX_LATITUDE &&
    lng >= LOC_MIN_LONGITUDE &&
    lng <= LOC_MAX_LONGITUDE
  );
}

/**
 * Checks if the current request rate exceeds the limit.
 * @function isRateLimited
 * @returns {boolean} Whether the current request rate is limited
 */
function isRateLimited() {
  const now = Date.now();
  const windowStart = now - LOC_RATE_LIMIT_WINDOW;
  
  for (const [timestamp] of LOC_RATE_LIMIT_COUNTS) {
    if (timestamp < windowStart) {
      LOC_RATE_LIMIT_COUNTS.delete(timestamp);
    }
  }
  
  let currentWindowCount = 0;
  for (const [timestamp, count] of LOC_RATE_LIMIT_COUNTS) {
    if (timestamp >= windowStart) {
      currentWindowCount += count;
    }
  }
  
  return currentWindowCount >= LOC_RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Records a new API request for rate limiting purposes.
 * @function recordRequest
 */
function recordRequest() {
  const now = Date.now();
  LOC_RATE_LIMIT_COUNTS.set(now, (LOC_RATE_LIMIT_COUNTS.get(now) || 0) + 1);
}

/**
 * Safely formats a URL by redacting the API key.
 * @function safeUrl
 * @param {string} url - The URL to format
 * @returns {string} The URL with redacted API key
 */
function safeUrl(url) {
  return url.replace(/key=([^&]+)/, 'key=REDACTED');
}

/**
 * Validates if a timezone string is valid.
 * @function isValidTimezone
 * @param {string} tz - The timezone to validate
 * @returns {boolean} Whether the timezone is valid
 */
function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.trim() === '') {
    return false;
  }
  
  const dt = DateTime.local().setZone(tz);
  return dt.isValid && dt.invalidReason === null;
}

/**
 * Retrieves geocoding data for a place name.
 * @async
 * @function getGeocodingData
 * @param {string} place - The place name to geocode
 * @returns {Promise<Object>} The geocoding result with location data
 * @throws {Error} If geocoding fails
 */
async function getGeocodingData(place) {
  try {
    if (!place || typeof place !== 'string' || place.trim() === '') {
      logger.warn("Invalid place name provided.", { place });
      return { error: true, type: LOC_ERROR_TYPES.INVALID_INPUT };
    }

    const cacheKey = `geocode:${place.toLowerCase().trim()}`;
    const cachedResult = LOC_CACHE.get(cacheKey);
    if (cachedResult) {
      logger.debug("Returning cached geocoding data.", { place });
      return cachedResult;
    }

    if (isRateLimited()) {
      logger.warn("Rate limit exceeded for geocoding API.", { place });
      return { error: true, type: LOC_ERROR_TYPES.RATE_LIMIT };
    }

    const geocodeParams = new URLSearchParams({
      address: place,
      key: config.googleApiKey
    });
    
    const geocodeRequestUrl = `${LOC_API_GEOCODING_URL}?${geocodeParams.toString()}`;
    
    logger.debug("Fetching geocoding data.", {
      place,
      requestUrl: safeUrl(geocodeRequestUrl)
    });
    
    recordRequest();
    
    const response = await axios.get(geocodeRequestUrl, { timeout: LOC_API_TIMEOUT_MS });
    
    if (response.status !== 200) {
      logger.warn("Google Geocoding API returned non-200 status.", { 
        status: response.status,
        place
      });
      
      return { error: true, type: LOC_ERROR_TYPES.API_ERROR };
    }
    
    const geoData = response.data;
    
    if (!geoData.results || geoData.results.length === 0) {
      logger.warn("No geocoding results found.", { place });
      return { error: true, type: LOC_ERROR_TYPES.NOT_FOUND };
    }
    
    const formattedAddress = geoData.results[0].formatted_address;
    const location = geoData.results[0].geometry.location;
    
    if (!isValidCoordinates(location.lat, location.lng)) {
      logger.warn("Invalid coordinates received from API.", { location });
      return { error: true, type: LOC_ERROR_TYPES.INVALID_INPUT };
    }
    
    const result = {
      error: false,
      location: location,
      formattedAddress: formattedAddress
    };
    
    LOC_CACHE.set(cacheKey, result);
    
    logger.debug("Successfully retrieved coordinates.", {
      place,
      address: formattedAddress,
      lat: location.lat,
      lng: location.lng
    });
    
    return result;
    
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      logger.error("Timeout while fetching geocoding data.", {
        place,
        error: error.message
      });
      return { error: true, type: LOC_ERROR_TYPES.TIMEOUT };
    }
    
    logger.error("Error fetching geocoding data.", {
      place,
      error: error.message,
      stack: error.stack
    });
    
    return { error: true, type: LOC_ERROR_TYPES.GENERAL };
  }
}

/**
 * Retrieves timezone data for a location.
 * @async
 * @function getTimezoneData
 * @param {Object} location - The location object with lat/lng
 * @param {number} [timestamp=Date.now()/1000] - The timestamp to use
 * @returns {Promise<Object>} The timezone data
 * @throws {Error} If timezone lookup fails
 */
async function getTimezoneData(location, timestamp = Math.floor(Date.now() / 1000)) {
  try {
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      logger.warn("Invalid location provided for timezone lookup.", { location });
      return { error: true, type: LOC_ERROR_TYPES.INVALID_INPUT };
    }
    
    const timezoneParams = new URLSearchParams({
      location: `${location.lat},${location.lng}`,
      timestamp: timestamp.toString(),
      key: config.googleApiKey
    });
    
    const timezoneRequestUrl = `${LOC_API_TIMEZONE_URL}?${timezoneParams.toString()}`;
    
    logger.debug("Fetching timezone data.", {
      lat: location.lat,
      lng: location.lng,
      requestUrl: safeUrl(timezoneRequestUrl)
    });
    
    const response = await axios.get(timezoneRequestUrl, { timeout: LOC_API_TIMEOUT_MS });
    
    if (response.status !== 200) {
      logger.warn("Google Timezone API returned non-200 status.", { 
        status: response.status,
        lat: location.lat,
        lng: location.lng 
      });
      
      return { error: true, type: LOC_ERROR_TYPES.API_ERROR };
    }
    
    const tzData = response.data;
    
    if (tzData.status !== LOC_API_STATUS_SUCCESS) {
      logger.warn("Error retrieving timezone info.", {
        status: tzData.status,
        lat: location.lat,
        lng: location.lng
      });
      
      return { error: true, type: LOC_ERROR_TYPES.GENERAL };
    }
    
    logger.debug("Successfully retrieved timezone data.", {
      timezoneId: tzData.timeZoneId,
      timezoneName: tzData.timeZoneName,
      rawOffset: tzData.rawOffset,
      dstOffset: tzData.dstOffset
    });
    
    return {
      error: false,
      timezoneId: tzData.timeZoneId,
      timezoneName: tzData.timeZoneName,
      rawOffset: tzData.rawOffset,
      dstOffset: tzData.dstOffset
    };
    
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      logger.error("Timeout while fetching timezone data.", {
        lat: location?.lat,
        lng: location?.lng,
        error: error.message
      });
      return { error: true, type: LOC_ERROR_TYPES.TIMEOUT };
    }
    
    logger.error("Error fetching timezone data.", {
      lat: location?.lat,
      lng: location?.lng,
      error: error.message,
      stack: error.stack
    });
    
    return { error: true, type: LOC_ERROR_TYPES.GENERAL };
  }
}

/**
 * Finds the closest timezone to given coordinates.
 * @function getClosestTimezone
 * @param {number} lat - The latitude
 * @param {number} lng - The longitude
 * @returns {string} The closest timezone identifier
 */
function getClosestTimezone(lat, lng) {
  const timezones = moment.tz.names();
  let closestTimezone = 'UTC';
  let minDistance = Infinity;

  for (const tz of timezones) {
    const zone = moment.tz.zone(tz);
    if (!zone) continue;

    const distance = Math.sqrt(
      Math.pow(zone.lat - lat, 2) + 
      Math.pow(zone.lng - lng, 2)
    );

    if (distance < minDistance) {
      minDistance = distance;
      closestTimezone = tz;
    }
  }

  return closestTimezone;
}

/**
 * Gets the UTC offset for a place.
 * @async
 * @function getUtcOffset
 * @param {string} place - The place name
 * @returns {Promise<Object>} The UTC offset information
 * @throws {Error} If offset lookup fails
 */
async function getUtcOffset(place) {
  try {
    const geocodeResult = await getGeocodingData(place);
    
    if (geocodeResult.error) {
      return {
        error: true,
        errorType: geocodeResult.type === LOC_ERROR_TYPES.TIMEOUT ? LOC_ERROR_TYPES.TIMEOUT : LOC_ERROR_TYPES.GENERAL
      };
    }
    
    const { location } = geocodeResult;
    const timestamp = dayjs().unix();
    
    const tzResult = await getTimezoneData(location, timestamp);
    
    if (tzResult.error) {
      return {
        error: true,
        errorType: tzResult.type === LOC_ERROR_TYPES.TIMEOUT ? LOC_ERROR_TYPES.TIMEOUT : LOC_ERROR_TYPES.GENERAL
      };
    }
    
    const rawOffset = tzResult.rawOffset / LOC_SECONDS_PER_HOUR;
    const dstOffset = tzResult.dstOffset / LOC_SECONDS_PER_HOUR;
    
    const timezoneName = tzResult.timezoneId;
    
    return {
      error: false,
      offset: rawOffset + dstOffset,
      timezoneId: tzResult.timezoneId,
      timeZoneName: timezoneName,
      formattedAddress: geocodeResult.formattedAddress
    };
    
  } catch (error) {
    logger.error("Error retrieving UTC offset.", {
      place,
      error: error.message,
      stack: error.stack
    });
    
    return {
      error: true,
      errorType: LOC_ERROR_TYPES.GENERAL
    };
  }
}

/**
 * Formats a place name for display.
 * @function formatPlaceName
 * @param {string} placeName - The place name to format
 * @returns {string} The formatted place name
 */
function formatPlaceName(placeName) {
  if (!placeName || typeof placeName !== 'string') return '';
  const trimmed = placeName.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Formats an error message for a location-related error.
 * @function formatErrorMessage
 * @param {string} place - The place name
 * @param {string} errorType - The type of error
 * @returns {string} The formatted error message
 */
function formatErrorMessage(place, errorType) {
  switch (errorType) {
    case LOC_ERROR_TYPES.NOT_FOUND:
    case LOC_ERROR_TYPES.GENERAL:
      return `⚠️ Could not find location "${place}". Please provide a valid city name.`;
    case LOC_ERROR_TYPES.INVALID_INPUT:
      return `⚠️ Invalid location format for "${place}". Please provide valid latitude and longitude.`;
    case LOC_ERROR_TYPES.API_ERROR:
      return '⚠️ Google Maps API error. Please try again later.';
    case LOC_ERROR_TYPES.TIMEOUT:
      return '⚠️ Request timed out. Please try again later.';
    case LOC_ERROR_TYPES.RATE_LIMIT:
      return '⚠️ Too many requests. Please try again later.';
    case LOC_ERROR_TYPES.CACHE_ERROR:
      return '⚠️ Cache error. Please try again later.';
    default:
      return '⚠️ An unexpected error occurred. Please try again later.';
  }
}

/**
 * Gets coordinates for a place name.
 * @async
 * @function getCoordinates
 * @param {string} place - The place name
 * @returns {Promise<Array<number>>} Array of [latitude, longitude]
 * @throws {Error} If coordinate lookup fails
 */
async function getCoordinates(place) {
  try {
    const geocodeResult = await getGeocodingData(place);
    
    if (geocodeResult.error) {
      logger.warn("Failed to get coordinates.", { 
        place, 
        errorType: geocodeResult.type 
      });
      return [null, null];
    }
    
    const { location } = geocodeResult;
    return [location.lat, location.lng];
    
  } catch (error) {
    logger.error("Error in getCoordinates function.", {
      place,
      error: error.message,
      stack: error.stack
    });
    
    return [null, null];
  }
}

module.exports = {
  LOC_API_GEOCODING_URL,
  LOC_API_TIMEZONE_URL,
  LOC_API_STATUS_SUCCESS,
  LOC_ERROR_TYPES,
  safeUrl,
  isValidTimezone,
  isValidCoordinates,
  getGeocodingData,
  getTimezoneData,
  getUtcOffset,
  formatPlaceName,
  formatErrorMessage,
  getCoordinates
};
