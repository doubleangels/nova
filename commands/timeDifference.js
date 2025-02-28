const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');

/**
 * Module for the /timedifference command.
 * Calculates the time difference between two places by retrieving their UTC offsets
 * using the Google Geocoding and Timezone APIs.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('timedifference')
    .setDescription('Get the time difference between two places.')
    .addStringOption(option =>
      option
        .setName('place1')
        .setDescription('Enter the first city name (e.g., New York).')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('place2')
        .setDescription('Enter the second city name (e.g., London).')
        .setRequired(true)
    ),
    
  /**
   * Executes the /timedifference command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer reply to allow time for processing.
      await interaction.deferReply();
      const place1 = interaction.options.getString('place1');
      const place2 = interaction.options.getString('place2');
      logger.debug("/timedifference command received:", { user: interaction.user.tag, place1, place2 });

      /**
       * Retrieves the UTC offset for a given city using Google Geocoding and Timezone APIs.
       * @param {string} city - The name of the city.
       * @returns {number|null} The combined UTC offset in hours, or null if lookup fails.
       */
      async function getUtcOffset(city) {
        // Build the Geocoding API URL.
        const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
        const geocodeParams = new URLSearchParams({
          address: city,
          key: config.googleApiKey
        });
        const geocodeRequestUrl = `${geocodeUrl}?${geocodeParams.toString()}`;
        logger.debug("Fetching geocoding data:", { city, requestUrl: geocodeRequestUrl });
        
        // Fetch geocoding data using axios.
        const geocodeResponse = await axios.get(geocodeRequestUrl);
        const geoData = geocodeResponse.data;

        if (geoData.results && geoData.results.length > 0) {
          const location = geoData.results[0].geometry.location;
          const lat = location.lat;
          const lng = location.lng;
          logger.debug("Geocoding success:", { city, lat, lng });
          const timestamp = dayjs().unix();

          // Build the Timezone API URL.
          const timezoneUrl = "https://maps.googleapis.com/maps/api/timezone/json";
          const timezoneParams = new URLSearchParams({
            location: `${lat},${lng}`,
            timestamp: timestamp.toString(),
            key: config.googleApiKey
          });
          const timezoneRequestUrl = `${timezoneUrl}?${timezoneParams.toString()}`;
          logger.debug("Fetching timezone data:", { city, requestUrl: timezoneRequestUrl });
          
          // Fetch timezone data using axios.
          const timezoneResponse = await axios.get(timezoneRequestUrl);
          const tzData = timezoneResponse.data;

          if (tzData.status === "OK") {
            const rawOffset = tzData.rawOffset / 3600; // seconds to hours.
            const dstOffset = tzData.dstOffset / 3600;   // seconds to hours.
            logger.debug("Timezone data retrieved:", { city, rawOffset, dstOffset });
            return rawOffset + dstOffset;
          } else {
            logger.warn("Timezone lookup failed:", { city, status: tzData.status });
            return null;
          }
        } else {
          logger.warn("Geocoding lookup failed:", { city });
          return null;
        }
      }

      // Retrieve UTC offsets for both places.
      const offset1 = await getUtcOffset(place1);
      const offset2 = await getUtcOffset(place2);
      logger.debug("UTC offsets retrieved:", { place1, offset1, place2, offset2 });

      // If either offset is null, inform the user.
      if (offset1 === null || offset2 === null) {
        logger.warn("Failed to retrieve one or both timezones:", { place1, offset1, place2, offset2 });
        await interaction.editReply(`❌ Could not retrieve timezones for '${place1}' or '${place2}'.`);
        return;
      }

      // Calculate the absolute time difference.
      const timeDiff = Math.abs(offset1 - offset2);

      // Format the place names (trim and capitalize first letter).
      const formattedPlace1 = place1.trim().charAt(0).toUpperCase() + place1.trim().slice(1);
      const formattedPlace2 = place2.trim().charAt(0).toUpperCase() + place2.trim().slice(1);

      // Create and send the reply message.
      const message = `⏳ The time difference between **${formattedPlace1}** and **${formattedPlace2}** is **${timeDiff} hours**.`;
      await interaction.editReply(message);
      logger.debug("Time difference calculation completed successfully:", { timeDiff, formattedPlace1, formattedPlace2 });
    } catch (error) {
      logger.error("Error in /timedifference command:", { error });
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
