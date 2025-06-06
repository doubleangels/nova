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
const { logError, ERROR_MESSAGES } = require('../errors');

const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEZONE_URL = 'https://maps.googleapis.com/maps/api/timezone/json';
const API_STATUS_SUCCESS = 'OK';
const API_TIMEOUT_MS = 5000;
const SECONDS_PER_HOUR = 3600;

const CACHE_TTL = 3600;
const locationCache = new NodeCache({ stdTTL: CACHE_TTL });

const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 50;
const requestCounts = new Map();

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

const ErrorTypes = {
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
    lat >= MIN_LATITUDE &&
    lat <= MAX_LATITUDE &&
    lng >= MIN_LONGITUDE &&
    lng <= MAX_LONGITUDE
  );
}

/**
 * Checks if the current request rate exceeds the limit.
 * @function isRateLimited
 * @returns {boolean} Whether the current request rate is limited
 */
function isRateLimited() {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  for (const [timestamp] of requestCounts) {
    if (timestamp < windowStart) {
      requestCounts.delete(timestamp);
    }
  }
  
  let currentWindowCount = 0;
  for (const [timestamp, count] of requestCounts) {
    if (timestamp >= windowStart) {
      currentWindowCount += count;
    }
  }
  
  return currentWindowCount >= MAX_REQUESTS_PER_WINDOW;
}

/**
 * Records a new API request for rate limiting purposes.
 * @function recordRequest
 */
function recordRequest() {
  const now = Date.now();
  requestCounts.set(now, (requestCounts.get(now) || 0) + 1);
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
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }

    const cacheKey = `geocode:${place.toLowerCase().trim()}`;
    const cachedResult = locationCache.get(cacheKey);
    if (cachedResult) {
      logger.debug("Returning cached geocoding data.", { place });
      return cachedResult;
    }

    if (isRateLimited()) {
      logger.warn("Rate limit exceeded for geocoding API.", { place });
      return { error: true, type: ErrorTypes.RATE_LIMIT };
    }

    const geocodeParams = new URLSearchParams({
      address: place,
      key: config.googleApiKey
    });
    
    const geocodeRequestUrl = `${GEOCODING_URL}?${geocodeParams.toString()}`;
    
    logger.debug("Fetching geocoding data.", {
      place,
      requestUrl: safeUrl(geocodeRequestUrl)
    });
    
    recordRequest();
    
    const response = await axios.get(geocodeRequestUrl, { timeout: API_TIMEOUT_MS });
    
    if (response.status !== 200) {
      logger.warn("Google Geocoding API returned non-200 status.", { 
        status: response.status,
        place
      });
      
      return { error: true, type: ErrorTypes.API_ERROR };
    }
    
    const geoData = response.data;
    
    if (!geoData.results || geoData.results.length === 0) {
      logger.warn("No geocoding results found.", { place });
      return { error: true, type: ErrorTypes.NOT_FOUND };
    }
    
    const formattedAddress = geoData.results[0].formatted_address;
    const location = geoData.results[0].geometry.location;
    
    if (!isValidCoordinates(location.lat, location.lng)) {
      logger.warn("Invalid coordinates received from API.", { location });
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }
    
    const result = {
      error: false,
      location: location,
      formattedAddress: formattedAddress
    };
    
    locationCache.set(cacheKey, result);
    
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
      return { error: true, type: ErrorTypes.TIMEOUT };
    }
    
    logger.error("Error fetching geocoding data.", {
      place,
      error: error.message,
      stack: error.stack
    });
    
    return { error: true, type: ErrorTypes.GENERAL };
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
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }
    
    const timezoneParams = new URLSearchParams({
      location: `${location.lat},${location.lng}`,
      timestamp: timestamp.toString(),
      key: config.googleApiKey
    });
    
    const timezoneRequestUrl = `${TIMEZONE_URL}?${timezoneParams.toString()}`;
    
    logger.debug("Fetching timezone data.", {
      lat: location.lat,
      lng: location.lng,
      requestUrl: safeUrl(timezoneRequestUrl)
    });
    
    const response = await axios.get(timezoneRequestUrl, { timeout: API_TIMEOUT_MS });
    
    if (response.status !== 200) {
      logger.warn("Google Timezone API returned non-200 status.", { 
        status: response.status,
        lat: location.lat,
        lng: location.lng 
      });
      
      return { error: true, type: ErrorTypes.API_ERROR };
    }
    
    const tzData = response.data;
    
    if (tzData.status !== API_STATUS_SUCCESS) {
      logger.warn("Error retrieving timezone info.", {
        status: tzData.status,
        lat: location.lat,
        lng: location.lng
      });
      
      return { error: true, type: ErrorTypes.GENERAL };
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
      return { error: true, type: ErrorTypes.TIMEOUT };
    }
    
    logger.error("Error fetching timezone data.", {
      lat: location?.lat,
      lng: location?.lng,
      error: error.message,
      stack: error.stack
    });
    
    return { error: true, type: ErrorTypes.GENERAL };
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
        errorType: geocodeResult.type === ErrorTypes.TIMEOUT ? ErrorTypes.TIMEOUT : ErrorTypes.GENERAL
      };
    }
    
    const { location } = geocodeResult;
    const timestamp = dayjs().unix();
    
    const tzResult = await getTimezoneData(location, timestamp);
    
    if (tzResult.error) {
      return {
        error: true,
        errorType: tzResult.type === ErrorTypes.TIMEOUT ? ErrorTypes.TIMEOUT : ErrorTypes.GENERAL
      };
    }
    
    const rawOffset = tzResult.rawOffset / SECONDS_PER_HOUR;
    const dstOffset = tzResult.dstOffset / SECONDS_PER_HOUR;
    
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
      errorType: ErrorTypes.GENERAL
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
    case ErrorTypes.NOT_FOUND:
    case ErrorTypes.GENERAL:
      return `⚠️ Could not find location "${place}". Please provide a valid city name.`;
    case ErrorTypes.INVALID_INPUT:
      return `⚠️ Invalid location format for "${place}". Please provide valid latitude and longitude.`;
    case ErrorTypes.API_ERROR:
      return '⚠️ Google Maps API error. Please try again later.';
    case ErrorTypes.TIMEOUT:
      return '⚠️ Request timed out. Please try again later.';
    case ErrorTypes.RATE_LIMIT:
      return '⚠️ Too many requests. Please try again later.';
    case ErrorTypes.CACHE_ERROR:
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
  GEOCODING_URL,
  TIMEZONE_URL,
  API_STATUS_SUCCESS,
  ErrorTypes,
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
