const fetch = require('node-fetch').default;
const logger = require('../logger');
const config = require('../config');

async function getCoordinates(city) {
  try {
    const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
    const params = new URLSearchParams({
      address: city,
      key: config.googleApiKey
    });
    
    logger.debug(`Requesting geocoding for city: ${city} with URL: ${geocodeUrl}?${params.toString()} (API key redacted)`);
    
    const response = await fetch(`${geocodeUrl}?${params.toString()}`);
    logger.debug(`Received response from Google Geocoding API with status code: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      logger.debug(`Google Geocoding API response for city '${city}': ${JSON.stringify(data, null, 2)}`);
      
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
  
  return [null, null];
}

module.exports = { getCoordinates };
