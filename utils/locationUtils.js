const axios = require('axios');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const config = require('../config');
const { DateTime } = require('luxon');
const dayjs = require('dayjs');

// We define these API configuration constants for consistent interaction with Google's services.
// We set a 5-second timeout for API requests to prevent hanging operations.
// We use this to prevent sensitive information from appearing in log files.
// We check this before attempting operations that require valid timezone data.
// We use this to convert human-readable locations to coordinates.
// We build the Geocoding API URL with the necessary parameters.
// We fetch geocoding data using axios with a timeout to prevent long-running requests.
// We handle timeout errors specifically to provide better feedback.
// We validate location input to prevent API errors.
// We build the Timezone API URL with the necessary parameters.
// We fetch timezone data using axios with a timeout for reliability.
// We handle timeout errors specifically for better user feedback.
// We first get the geocoding data to convert the place name to coordinates.
// We then get the timezone data for those coordinates.
// We convert seconds to hours for a more user-friendly format.
// We get the geocoding data for the place and extract just the coordinates.
const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEZONE_URL = 'https://maps.googleapis.com/maps/api/timezone/json';
const API_STATUS_SUCCESS = 'OK';
const API_TIMEOUT_MS = 5000;
const SECONDS_PER_HOUR = 3600;

/**
 * Removes API keys from URLs for safe logging.
 * We use this to prevent sensitive information from appearing in log files.
 *
 * @param {string} url - The URL that may contain sensitive information.
 * @returns {string} The sanitized URL.
 */
function safeUrl(url) {
  return url.replace(/key=([^&]+)/, 'key=REDACTED');
}

/**
 * Validates if a timezone identifier is valid using Luxon.
 * We check this before attempting operations that require valid timezone data.
 * 
 * @param {string} tz - The timezone identifier to validate.
 * @returns {boolean} True if the timezone is valid, false otherwise.
 */
function isValidTimezone(tz) {
  // We check if the input is a non-empty string.
  if (typeof tz !== 'string' || tz.trim() === '') {
    return false;
  }
  
  // We try to create a DateTime object with the timezone to test its validity.
  const dt = DateTime.local().setZone(tz);
  
  // We check if the DateTime object is valid and has no errors.
  return dt.isValid && dt.invalidReason === null;
}

/**
 * Fetches geocoding data for a given place name.
 * We use this to convert human-readable locations to coordinates.
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

    // We build the Geocoding API URL with the necessary parameters.
    const geocodeParams = new URLSearchParams({
      address: place,
      key: config.googleApiKey
    });
    
    const geocodeRequestUrl = `${GEOCODING_URL}?${geocodeParams.toString()}`;
    
    logger.debug("Fetching geocoding data.", {
      place,
      requestUrl: safeUrl(geocodeRequestUrl)
    });
    
    // We fetch geocoding data using axios with a timeout to prevent long-running requests.
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
    // We handle timeout errors specifically to provide better feedback.
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
 * We use this to determine the timezone and UTC offset for a specific location.
 *
 * @param {Object} location - The location object with lat and lng properties.
 * @param {number} [timestamp] - Optional UNIX timestamp (seconds). Defaults to current time.
 * @returns {Promise<Object>} An object containing timezone results or error information.
 */
async function getTimezoneData(location, timestamp = Math.floor(Date.now() / 1000)) {
  try {
    // We validate location input to prevent API errors.
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      logger.warn("Invalid location provided for timezone lookup.", { location });
      return { error: true, type: 'invalid_input' };
    }
    
    // We build the Timezone API URL with the necessary parameters.
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
    
    // We fetch timezone data using axios with a timeout for reliability.
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
    // We handle timeout errors specifically for better user feedback.
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
 * We combine geocoding and timezone data to determine the complete timezone information.
 *
 * @param {string} place - The place name to lookup.
 * @returns {Promise<Object>} An object containing either the offset or error information.
 */
async function getUtcOffset(place) {
  try {
    // We first get the geocoding data to convert the place name to coordinates.
    const geocodeResult = await getGeocodingData(place);
    
    if (geocodeResult.error) {
      return {
        error: true,
        errorType: geocodeResult.type === 'timeout' ? 'timeout' : 'geocoding'
      };
    }
    
    const { location } = geocodeResult;
    const timestamp = dayjs().unix();
    
    // We then get the timezone data for those coordinates.
    const tzResult = await getTimezoneData(location, timestamp);
    
    if (tzResult.error) {
      return {
        error: true,
        errorType: tzResult.type === 'timeout' ? 'timeout' : 'timezone'
      };
    }
    
    // We convert seconds to hours for a more user-friendly format.
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
 * We use this to standardize location names for display purposes.
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
 * We provide user-friendly error messages that explain what went wrong.
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

/**
 * Gets the coordinates (latitude and longitude) for a given place name.
 * We provide this as a simplified interface for just getting location coordinates.
 *
 * @param {string} place - The place name to get coordinates for.
 * @returns {Promise<[number|null, number|null]>} A promise that resolves to an array containing [latitude, longitude].
 */
async function getCoordinates(place) {
  try {
    // We get the geocoding data for the place and extract just the coordinates.
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
  safeUrl,
  isValidTimezone,
  getGeocodingData,
  getTimezoneData,
  getUtcOffset,
  formatPlaceName,
  formatErrorMessage,
  getCoordinates
};
