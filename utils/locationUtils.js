const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch');
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
  const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
  const params = new URLSearchParams({
    address: city,
    key: config.googleApiKey
  });

  try {
    logger.debug(
      `Requesting geocoding for city "${city}". URL: ${geocodeUrl}?${params.toString().replace(config.googleApiKey, '[REDACTED]')}`
    );

    const response = await fetch(`${geocodeUrl}?${params.toString()}`);
    logger.debug(`Received response for city "${city}" with status code: ${response.status}`);

    if (!response.ok) {
      logger.error(`Non-OK response from Google Geocoding API for city "${city}". Status: ${response.status}`);
      return [null, null];
    }

    const data = await response.json();
    logger.debug(`Google Geocoding API JSON response for city "${city}": ${JSON.stringify(data)}`);

    if (data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      const lat = location.lat;
      const lon = location.lng;
      logger.info(`Coordinates retrieved for city "${city}": latitude=${lat}, longitude=${lon}`);
      return [lat, lon];
    } else {
      logger.warn(`No results returned from Google Geocoding API for city "${city}".`);
      return [null, null];
    }
  } catch (error) {
    logger.error(`Error fetching coordinates for city "${city}": ${error.message}`, { error });
    return [null, null];
  }
}

module.exports = { getCoordinates };
