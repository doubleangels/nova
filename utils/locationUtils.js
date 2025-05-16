const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { DateTime } = require('luxon');
const dayjs = require('dayjs');
const moment = require('moment-timezone');
const NodeCache = require('node-cache');

// We define these configuration constants for consistent interaction with Google's services.
const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEZONE_URL = 'https://maps.googleapis.com/maps/api/timezone/json';
const API_STATUS_SUCCESS = 'OK';
const API_TIMEOUT_MS = 5000;
const SECONDS_PER_HOUR = 3600;

// We configure the cache with a one-hour TTL to reduce API calls and improve performance.
const CACHE_TTL = 3600; // 1 hour in seconds
const locationCache = new NodeCache({ stdTTL: CACHE_TTL });

// We set up rate limiting parameters to prevent API abuse and ensure fair usage.
const RATE_LIMIT_WINDOW = 60000; // 1 minute in milliseconds
const MAX_REQUESTS_PER_WINDOW = 50;
const requestCounts = new Map();

// We define valid coordinate ranges to ensure data integrity and prevent invalid API calls.
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

// We define standard error types for consistent error handling across the application.
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
 * We validate coordinates are within valid ranges to ensure data integrity.
 * This function checks both the type and range of latitude and longitude values.
 * 
 * @param {number} lat - Latitude value to validate.
 * @param {number} lng - Longitude value to validate.
 * @returns {boolean} True if coordinates are valid, false otherwise.
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
 * We check if we've exceeded the rate limit to prevent API abuse.
 * This function implements a sliding window rate limiter that tracks requests over time.
 * 
 * @returns {boolean} True if rate limit is exceeded, false otherwise.
 */
function isRateLimited() {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  // We clean up old requests to prevent memory leaks and ensure accurate rate limiting.
  for (const [timestamp] of requestCounts) {
    if (timestamp < windowStart) {
      requestCounts.delete(timestamp);
    }
  }
  
  // We count requests in current window to determine if we've exceeded the limit.
  let currentWindowCount = 0;
  for (const [timestamp, count] of requestCounts) {
    if (timestamp >= windowStart) {
      currentWindowCount += count;
    }
  }
  
  return currentWindowCount >= MAX_REQUESTS_PER_WINDOW;
}

/**
 * We record an API request for rate limiting purposes.
 * This function maintains a timestamp-based count of requests for rate limiting.
 */
function recordRequest() {
  const now = Date.now();
  requestCounts.set(now, (requestCounts.get(now) || 0) + 1);
}

/**
 * We remove API keys from URLs for safe logging.
 * This function prevents sensitive information from appearing in log files.
 * 
 * @param {string} url - The URL that may contain sensitive information.
 * @returns {string} The sanitized URL with API keys redacted.
 */
function safeUrl(url) {
  return url.replace(/key=([^&]+)/, 'key=REDACTED');
}

/**
 * We validate if a timezone identifier is valid using Luxon.
 * This function ensures that timezone operations will work correctly.
 * 
 * @param {string} tz - The timezone identifier to validate
 * @returns {boolean} True if the timezone is valid, false otherwise
 */
function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.trim() === '') {
    return false;
  }
  
  const dt = DateTime.local().setZone(tz);
  return dt.isValid && dt.invalidReason === null;
}

/**
 * We fetch geocoding data for a given place name with caching and rate limiting.
 * This function handles the conversion of human-readable locations to coordinates.
 * 
 * @param {string} place - The place name to geocode.
 * @returns {Promise<Object>} An object containing geocoding results or error information.
 */
async function getGeocodingData(place) {
  try {
    // We validate the input to prevent API errors and ensure data quality.
    if (!place || typeof place !== 'string' || place.trim() === '') {
      logger.warn("Invalid place name provided.", { place });
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }

    // We check the cache to improve performance and reduce API calls.
    const cacheKey = `geocode:${place.toLowerCase().trim()}`;
    const cachedResult = locationCache.get(cacheKey);
    if (cachedResult) {
      logger.debug("Returning cached geocoding data.", { place });
      return cachedResult;
    }

    // We check rate limits to prevent API abuse and ensure fair usage.
    if (isRateLimited()) {
      logger.warn("Rate limit exceeded for geocoding API.", { place });
      return { error: true, type: ErrorTypes.RATE_LIMIT };
    }

    // We build the request with proper parameters and error handling.
    const geocodeParams = new URLSearchParams({
      address: place,
      key: config.googleApiKey
    });
    
    const geocodeRequestUrl = `${GEOCODING_URL}?${geocodeParams.toString()}`;
    
    logger.debug("Fetching geocoding data.", {
      place,
      requestUrl: safeUrl(geocodeRequestUrl)
    });
    
    // We record the request for rate limiting purposes.
    recordRequest();
    
    // We make the API call with proper timeout and error handling.
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
    
    // We validate the coordinates to ensure data integrity.
    if (!isValidCoordinates(location.lat, location.lng)) {
      logger.warn("Invalid coordinates received from API.", { location });
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }
    
    const result = {
      error: false,
      location: location,
      formattedAddress: formattedAddress
    };
    
    // We cache the result to improve future performance.
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
 * We fetch timezone data for given coordinates.
 * This function determines the timezone and UTC offset for a specific location.
 * 
 * @param {Object} location - The location object with lat and lng properties.
 * @param {number} [timestamp] - Optional UNIX timestamp (seconds). Defaults to current time.
 * @returns {Promise<Object>} An object containing timezone results or error information.
 */
async function getTimezoneData(location, timestamp = Math.floor(Date.now() / 1000)) {
  try {
    // We validate the location input to prevent API errors.
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      logger.warn("Invalid location provided for timezone lookup.", { location });
      return { error: true, type: ErrorTypes.INVALID_INPUT };
    }
    
    // We build the timezone request with proper parameters.
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
    
    // We make the API call with proper timeout and error handling.
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
 * We get the closest timezone name from moment-timezone based on coordinates.
 * @param {number} lat - Latitude.
 * @param {number} lng - Longitude.
 * @returns {string} The closest timezone name.
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
 * We retrieve the UTC offset for a given place.
 * This function combines geocoding and timezone data to determine the complete timezone information.
 * 
 * @param {string} place - The place name to lookup.
 * @returns {Promise<Object>} An object containing either the offset or error information.
 */
async function getUtcOffset(place) {
  try {
    // We get the geocoding data first to convert the place name to coordinates.
    const geocodeResult = await getGeocodingData(place);
    
    if (geocodeResult.error) {
      return {
        error: true,
        errorType: geocodeResult.type === ErrorTypes.TIMEOUT ? ErrorTypes.TIMEOUT : ErrorTypes.GENERAL
      };
    }
    
    const { location } = geocodeResult;
    const timestamp = dayjs().unix();
    
    // We get the timezone data for the coordinates.
    const tzResult = await getTimezoneData(location, timestamp);
    
    if (tzResult.error) {
      return {
        error: true,
        errorType: tzResult.type === ErrorTypes.TIMEOUT ? ErrorTypes.TIMEOUT : ErrorTypes.GENERAL
      };
    }
    
    // We convert seconds to hours for a more user-friendly format.
    const rawOffset = tzResult.rawOffset / SECONDS_PER_HOUR;
    const dstOffset = tzResult.dstOffset / SECONDS_PER_HOUR;
    
    // Use the timezone ID from Google API directly.
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
 * We format a place name by trimming and capitalizing the first letter.
 * This function standardizes location names for display purposes.
 * 
 * @param {string} placeName - The place name to format.
 * @returns {string} The formatted place name.
 */
function formatPlaceName(placeName) {
  if (!placeName || typeof placeName !== 'string') return '';
  const trimmed = placeName.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * We format an error message based on the error type.
 * This function provides user-friendly error messages that explain what went wrong.
 * 
 * @param {string} place - The place name that caused the error
 * @param {string} errorType - The type of error that occurred
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
 * We get the coordinates (latitude and longitude) for a given place name.
 * This function provides a simplified interface for just getting location coordinates.
 * 
 * @param {string} place - The place name to get coordinates for.
 * @returns {Promise<[number|null, number|null]>} A promise that resolves to an array containing [latitude, longitude].
 */
async function getCoordinates(place) {
  try {
    // We get the geocoding data and extract just the coordinates.
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
