const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { DateTime } = require('luxon');
const dayjs = require('dayjs');

// API configuration constants.
const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEZONE_URL = 'https://maps.googleapis.com/maps/api/timezone/json';
const API_STATUS_SUCCESS = 'OK';
const API_TIMEOUT_MS = 5000; // 5-second timeout for API requests.
const SECONDS_PER_HOUR = 3600;

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
 * Validates if a timezone identifier is valid using Luxon.
 * 
 * @param {string} tz - The timezone identifier to validate.
 * @returns {boolean} True if the timezone is valid, false otherwise.
 */
function isValidTimezone(tz) {
  // Check if the input is a non-empty string.
  if (typeof tz !== 'string' || tz.trim() === '') {
    return false;
  }
  
  // Try to create a DateTime object with the timezone.
  const dt = DateTime.local().setZone(tz);
  
  // Check if the DateTime object is valid.
  return dt.isValid && dt.invalidReason === null;
}

/**
 * Fetches geocoding data for a given place name.
 *
 * @param {string} place - The place name to geocode.
 * @returns {Promise<Object>} An object containing geocoding results or error information.
 */
async function getGeocodingData(place) {
  try {
    if (!place || typeof place !== 'string' || place.trim() === '') {
      logger.warn("Invalid place name provided.", { place });
      return { error: true, type: 'not_found' };
    }

    // Build the Geocoding API URL.
    const geocodeParams = new URLSearchParams({
      address: place,
      key: config.googleApiKey
    });
    
    const geocodeRequestUrl = `${GEOCODING_URL}?${geocodeParams.toString()}`;
    
    logger.debug("Fetching geocoding data.", {
      place,
      requestUrl: safeUrl(geocodeRequestUrl)
    });
    
    // Fetch geocoding data using axios with timeout.
    const response = await axios.get(geocodeRequestUrl, { timeout: API_TIMEOUT_MS });
    
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
    // Handle timeout errors specifically.
    if (error.code === 'ECONNABORTED') {
      logger.error("Timeout while fetching geocoding data.", {
        place,
        error: error.message
      });
      return { error: true, type: 'timeout' };
    }
    
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
 * @param {number} [timestamp] - Optional UNIX timestamp (seconds). Defaults to current time.
 * @returns {Promise<Object>} An object containing timezone results or error information.
 */
async function getTimezoneData(location, timestamp = Math.floor(Date.now() / 1000)) {
  try {
    // Validate location input.
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      logger.warn("Invalid location provided for timezone lookup.", { location });
      return { error: true, type: 'invalid_input' };
    }
    
    // Build the Timezone API URL.
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
    
    // Fetch timezone data using axios with timeout.
    const response = await axios.get(timezoneRequestUrl, { timeout: API_TIMEOUT_MS });
    
    if (response.status !== 200) {
      logger.warn("Google Timezone API returned non-200 status.", { 
        status: response.status,
        lat: location.lat,
        lng: location.lng 
      });
      
      return { error: true, type: 'api_error' };
    }
    
    const tzData = response.data;
    
    if (tzData.status !== API_STATUS_SUCCESS) {
      logger.warn("Error retrieving timezone info.", {
        status: tzData.status,
        lat: location.lat,
        lng: location.lng
      });
      
      return { error: true, type: 'invalid_response' };
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
    // Handle timeout errors specifically.
    if (error.code === 'ECONNABORTED') {
      logger.error("Timeout while fetching timezone data.", {
        lat: location?.lat,
        lng: location?.lng,
        error: error.message
      });
      return { error: true, type: 'timeout' };
    }
    
    logger.error("Error fetching timezone data.", {
      lat: location?.lat,
      lng: location?.lng,
      error: error.message,
      stack: error.stack
    });
    
    return { error: true, type: 'exception' };
  }
}

/**
 * Retrieves the UTC offset for a given place.
 *
 * @param {string} place - The place name to lookup.
 * @returns {Promise<Object>} An object containing either the offset or error information.
 */
async function getUtcOffset(place) {
  try {
    // Get the geocoding data for the place.
    const geocodeResult = await getGeocodingData(place);
    
    if (geocodeResult.error) {
      return {
        error: true,
        errorType: geocodeResult.type === 'timeout' ? 'timeout' : 'geocoding'
      };
    }
    
    const { location } = geocodeResult;
    const timestamp = dayjs().unix();
    
    // Get the timezone data for the location.
    const tzResult = await getTimezoneData(location, timestamp);
    
    if (tzResult.error) {
      return {
        error: true,
        errorType: tzResult.type === 'timeout' ? 'timeout' : 'timezone'
      };
    }
    
    // Convert seconds to hours.
    const rawOffset = tzResult.rawOffset / SECONDS_PER_HOUR;
    const dstOffset = tzResult.dstOffset / SECONDS_PER_HOUR;
    
    return {
      error: false,
      offset: rawOffset + dstOffset,
      timezoneId: tzResult.timezoneId,
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
      errorType: 'general'
    };
  }
}

/**
 * Formats a place name by trimming and capitalizing the first letter.
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
 * Formats an error message based on the error type.
 *
 * @param {string} place - The place name that caused the error.
 * @param {string} errorType - The type of error that occurred.
 * @returns {string} The formatted error message.
 */
function formatErrorMessage(place, errorType) {
  switch (errorType) {
    case 'not_found':
    case 'geocoding':
      return `⚠️ Could not find location "${place}". Please provide a valid city name.`;
    case 'invalid_response':
    case 'timezone':
      return `⚠️ Could not determine timezone for "${place}". Please try a different city.`;
    case 'api_error':
      return '⚠️ Google Maps API error. Please try again later.';
    case 'timeout':
      return '⚠️ Request timed out. Please try again later.';
    default:
      return '⚠️ An unexpected error occurred. Please try again later.';
  }
}

module.exports = {
  GEOCODING_URL,
  TIMEZONE_URL,
  API_STATUS_SUCCESS,
  safeUrl,
  isValidTimezone,
  getGeocodingData,
  getTimezoneData,
  getUtcOffset,
  formatPlaceName,
  formatErrorMessage
};
