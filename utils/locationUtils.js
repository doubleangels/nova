const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { DateTime } = require('luxon');
const dayjs = require('dayjs');
const moment = require('moment-timezone');
const NodeCache = require('node-cache');

// API endpoints and constants
const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEZONE_URL = 'https://maps.googleapis.com/maps/api/timezone/json';
const API_STATUS_SUCCESS = 'OK';
const API_TIMEOUT_MS = 5000;
const SECONDS_PER_HOUR = 3600;

// Caching configuration
const CACHE_TTL = 3600; // Cache time-to-live in seconds
const locationCache = new NodeCache({ stdTTL: CACHE_TTL });

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60000; // 1 minute in milliseconds
const MAX_REQUESTS_PER_WINDOW = 50;
const requestTimestamps = [];

// Coordinate bounds
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * Error type constants for location operations
 * 
 * @enum {string}
 */
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
 * Validates whether given coordinates are within valid ranges.
 * 
 * @param {number} lat - Latitude value to check
 * @param {number} lng - Longitude value to check
 * @returns {boolean} True if coordinates are valid, false otherwise
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
 * Checks if the current request would exceed the rate limit.
 * Also manages the tracking of request timestamps.
 * 
 * @returns {boolean} True if rate limited, false otherwise
 */
function isRateLimited() {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  // Remove old timestamps that are outside the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < windowStart) {
    requestTimestamps.shift();
  }
  
  if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  // Add current timestamp to the tracking array
  requestTimestamps.push(now);
  return false;
}

/**
 * Creates a safe version of a URL by redacting API keys.
 * 
 * @param {string} url - URL potentially containing API keys
 * @returns {string} URL with API key redacted
 */
function safeUrl(url) {
  return url.replace(/key=[^&]+/, 'key=REDACTED');
}

/**
 * Validates if a timezone string is valid.
 * 
 * @param {string} tz - Timezone identifier to validate
 * @returns {boolean} True if timezone is valid, false otherwise
 */
function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.trim() === '') {
    return false;
  }
  
  const dt = DateTime.local().setZone(tz);
  return dt.isValid && dt.invalidReason === null;
}

/**
 * Retrieves geocoding data for a location from Google Maps API.
 * Uses caching to reduce API calls for repeated queries.
 * 
 * @async
 * @param {string} place - Location name or address to geocode
 * @returns {Promise<Object>} Geocoding result or error object
 */
async function getGeocodingData(place) {
  try {
    if (!place || typeof place !== 'string' || place.trim() === '') {
      logger.warn("Invalid place name provided.", { place });
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }

    // Check cache first
    const cacheKey = `geocode:${place.toLowerCase().trim()}`;
    const cachedResult = locationCache.get(cacheKey);
    if (cachedResult) {
      logger.debug("Returning cached geocoding data.", { place });
      return cachedResult;
    }

    // Check rate limit before making API call
    if (isRateLimited()) {
      logger.warn("Rate limit exceeded for geocoding API.", { place });
      return { error: true, type: ErrorTypes.RATE_LIMIT };
    }

    // Prepare API request
    const geocodeParams = new URLSearchParams({
      address: place,
      key: config.googleApiKey
    });
    
    const geocodeRequestUrl = `${GEOCODING_URL}?${geocodeParams.toString()}`;
    
    logger.debug("Fetching geocoding data.", {
      place,
      requestUrl: safeUrl(geocodeRequestUrl)
    });
    
    // Make API request
    const response = await axios.get(geocodeRequestUrl, { timeout: API_TIMEOUT_MS });
    
    if (response.status !== 200) {
      logger.warn("Google Geocoding API returned non-200 status.", { 
        status: response.status,
        place
      });
      
      return { error: true, type: ErrorTypes.API_ERROR };
    }
    
    const geoData = response.data;
    
    // Check if results were found
    if (!geoData.results || geoData.results.length === 0) {
      logger.warn("No geocoding results found.", { place });
      return { error: true, type: ErrorTypes.NOT_FOUND };
    }
    
    const formattedAddress = geoData.results[0].formatted_address;
    const location = geoData.results[0].geometry.location;
    
    // Validate received coordinates
    if (!isValidCoordinates(location.lat, location.lng)) {
      logger.warn("Invalid coordinates received from API.", { location });
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }
    
    // Prepare successful result
    const result = {
      error: false,
      location: location,
      formattedAddress: formattedAddress
    };
    
    // Cache the result
    locationCache.set(cacheKey, result);
    
    logger.debug("Successfully retrieved coordinates.", {
      place,
      address: formattedAddress,
      lat: location.lat,
      lng: location.lng
    });
    
    return result;
    
  } catch (error) {
    // Handle timeout errors specifically
    if (error.code === 'ECONNABORTED') {
      logger.error("Timeout while fetching geocoding data.", {
        place,
        error: error.message
      });
      return { error: true, type: ErrorTypes.TIMEOUT };
    }
    
    // Handle other errors
    logger.error("Error fetching geocoding data.", {
      place,
      error: error.message,
      stack: error.stack
    });
    
    return { error: true, type: ErrorTypes.GENERAL };
  }
}

/**
 * Retrieves timezone data for a location from Google Maps API.
 * 
 * @async
 * @param {Object} location - Location object with lat and lng properties
 * @param {number} [timestamp=Math.floor(Date.now() / 1000)] - Unix timestamp
 * @returns {Promise<Object>} Timezone result or error object
 */
async function getTimezoneData(location, timestamp = Math.floor(Date.now() / 1000)) {
  try {
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      logger.warn("Invalid location provided for timezone lookup.", { location });
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }
    
    // Prepare API request
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
    
    // Make API request
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
    
    // Check API response status
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
    
    // Return successful result
    return {
      error: false,
      timezoneId: tzData.timeZoneId,
      timezoneName: tzData.timeZoneName,
      rawOffset: tzData.rawOffset,
      dstOffset: tzData.dstOffset
    };
    
  } catch (error) {
    // Handle timeout errors specifically
    if (error.code === 'ECONNABORTED') {
      logger.error("Timeout while fetching timezone data.", {
        lat: location?.lat,
        lng: location?.lng,
        error: error.message
      });
      return { error: true, type: ErrorTypes.TIMEOUT };
    }
    
    // Handle other errors
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
 * Gets the closest timezone identifier for given coordinates.
 * 
 * @async
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<string>} Timezone identifier
 * @throws {Error} If coordinates are invalid or API request fails
 */
async function getClosestTimezone(lat, lng) {
  try {
    if (isRateLimited()) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    if (!isValidCoordinates(lat, lng)) {
      throw new Error('Invalid coordinates provided.');
    }

    const response = await axios.get(TIMEZONE_URL, {
      params: {
        location: `${lat},${lng}`,
        timestamp: Math.floor(Date.now() / 1000),
        key: config.googleApiKey
      }
    });

    if (response.data.status !== 'OK') {
      throw new Error(`Timezone API error: ${response.data.status}`);
    }

    const timezoneId = response.data.timeZoneId;
    if (!moment.tz.zone(timezoneId)) {
      throw new Error('Invalid timezone returned from API');
    }

    return timezoneId;
  } catch (error) {
    logger.error('Error getting timezone:', {
      error: error.message,
      lat,
      lng,
      url: safeUrl(error.config?.url)
    });
    throw error;
  }
}

/**
 * Gets the UTC offset for a given place name.
 * Performs geocoding and timezone lookup in sequence.
 * 
 * @async
 * @param {string} place - Location name or address
 * @returns {Promise<Object>} UTC offset information or error object
 */
async function getUtcOffset(place) {
  try {
    // First get coordinates for the place
    const geocodeResult = await getGeocodingData(place);
    
    if (geocodeResult.error) {
      return {
        error: true,
        errorType: geocodeResult.type === ErrorTypes.TIMEOUT ? ErrorTypes.TIMEOUT : ErrorTypes.GENERAL
      };
    }
    
    const { location } = geocodeResult;
    const timestamp = dayjs().unix();
    
    // Then get timezone data for those coordinates
    const tzResult = await getTimezoneData(location, timestamp);
    
    if (tzResult.error) {
      return {
        error: true,
        errorType: tzResult.type === ErrorTypes.TIMEOUT ? ErrorTypes.TIMEOUT : ErrorTypes.GENERAL
      };
    }
    
    // Calculate UTC offset (including DST)
    const rawOffset = tzResult.rawOffset / SECONDS_PER_HOUR;
    const dstOffset = tzResult.dstOffset / SECONDS_PER_HOUR;
    
    const timezoneName = tzResult.timezoneId;
    
    // Return successful result
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
 * Formats a place name with proper capitalization.
 * 
 * @param {string} placeName - Place name to format
 * @returns {string} Formatted place name
 */
function formatPlaceName(placeName) {
  if (!placeName || typeof placeName !== 'string') return '';
  const trimmed = placeName.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Generates user-friendly error messages based on error types.
 * 
 * @param {string} place - Place name that caused the error
 * @param {string} errorType - Type of error from ErrorTypes enum
 * @returns {string} Formatted error message
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
 * Simplified wrapper around getGeocodingData.
 * 
 * @async
 * @param {string} place - Place name to get coordinates for
 * @returns {Promise<Array<number|null>>} Array with [latitude, longitude] or [null, null] on error
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
  getCoordinates,
  getClosestTimezone
}; 