const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

/**
 * Retrieves the geographical coordinates (latitude and longitude) for a given city using
 * the Google Geocoding API.
 *
 * @param {string} city - The name of the city for which to retrieve coordinates.
 * @returns {Promise<Array<number|null>>} A promise that resolves to an array containing the latitude and longitude.
 *                                        If the coordinates cannot be retrieved, returns [null, null].
 */
async function getCoordinates(city) {
  try {
    // Construct the Google Geocoding API URL and query parameters.
    const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
    const params = new URLSearchParams({
      address: city,
      key: config.googleApiKey
    });
    
    // Log the API request details. The API key is redacted in the logs.
    logger.debug(`Requesting geocoding for city: ${city} with URL: ${geocodeUrl}?${params.toString()} (API key redacted)`);
    
    // Fetch data from the Google Geocoding API.
    const response = await fetch(`${geocodeUrl}?${params.toString()}`);
    logger.debug(`Received response from Google Geocoding API with status code: ${response.status}`);
    
    if (response.ok) {
      // Parse the JSON response.
      const data = await response.json();
      logger.debug(`Google Geocoding API response for city '${city}': ${JSON.stringify(data, null, 2)}`);
      
      // Check if any results were returned.
      if (data.results && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        const lat = location.lat;
        const lon = location.lng;
        logger.debug(`Coordinates for city '${city}' retrieved: lat=${lat}, lon=${lon}`);
        return [lat, lon];
      } else {
        logger.warn(`No geocoding results found for city: '${city}'.`);
      }
    } else {
      logger.error(`Google Geocoding API returned non-200 status code: ${response.status} for city: '${city}'.`);
    }
  } catch (error) {
    logger.error(`Error fetching coordinates for city '${city}': ${error}`);
  }
  
  // Return null coordinates if any step fails.
  return [null, null];
}

module.exports = { getCoordinates };
