const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

/**
 * Module for the /timedifference command.
 * This command calculates the time difference between two places by retrieving their UTC offsets using the Google Geocoding
 * and Timezone APIs.
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
      // Defer reply to allow time for processing the request.
      await interaction.deferReply();
      const place1 = interaction.options.getString('place1');
      const place2 = interaction.options.getString('place2');
      logger.debug(`/timedifference command received with place1: '${place1}', place2: '${place2}'`);

      /**
       * Retrieves the UTC offset for a given city using Google Geocoding and Timezone APIs.
       * @param {string} city - The name of the city.
       * @returns {number|null} The combined UTC offset in hours, or null if lookup fails.
       */
      async function getUtcOffset(city) {
        // Build the Geocoding API URL with parameters.
        const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
        const geocodeParams = new URLSearchParams({
          address: city,
          key: config.googleApiKey
        });
        // Fetch geocoding data.
        const geocodeResponse = await fetch(`${geocodeUrl}?${geocodeParams.toString()}`);
        const geoData = await geocodeResponse.json();
        // Check if geocoding returned any results.
        if (geoData.results && geoData.results.length > 0) {
          const location = geoData.results[0].geometry.location;
          const lat = location.lat;
          const lng = location.lng;
          // Get the current timestamp in seconds.
          const timestamp = Math.floor(Date.now() / 1000);
          // Build the Timezone API URL with parameters.
          const timezoneUrl = "https://maps.googleapis.com/maps/api/timezone/json";
          const timezoneParams = new URLSearchParams({
            location: `${lat},${lng}`,
            timestamp: timestamp.toString(),
            key: config.googleApiKey
          });
          // Fetch timezone data.
          const timezoneResponse = await fetch(`${timezoneUrl}?${timezoneParams.toString()}`);
          const tzData = await timezoneResponse.json();
          // If the timezone lookup is successful, calculate the total offset.
          if (tzData.status === "OK") {
            const rawOffset = tzData.rawOffset / 3600; // Convert seconds to hours.
            const dstOffset = tzData.dstOffset / 3600;   // Convert seconds to hours.
            return rawOffset + dstOffset;
          } else {
            logger.warn(`Timezone lookup failed for city '${city}': ${tzData.status}`);
            return null;
          }
        } else {
          logger.warn(`Geocoding failed for city '${city}'`);
          return null;
        }
      }

      // Retrieve UTC offsets for both places.
      const offset1 = await getUtcOffset(place1);
      const offset2 = await getUtcOffset(place2);

      // If either offset is null, inform the user about the failure.
      if (offset1 === null || offset2 === null) {
        logger.warn(`Could not retrieve timezones for '${place1}' or '${place2}'`);
        await interaction.editReply(`❌ Could not retrieve timezones for '${place1}' or '${place2}'.`);
        return;
      }

      // Calculate the absolute time difference.
      const timeDiff = Math.abs(offset1 - offset2);

      // Format the place names by trimming and capitalizing the first letter.
      const formattedPlace1 = place1.trim().charAt(0).toUpperCase() + place1.trim().slice(1);
      const formattedPlace2 = place2.trim().charAt(0).toUpperCase() + place2.trim().slice(1);

      // Create the reply message.
      const message = `⏳ The time difference between **${formattedPlace1}** and **${formattedPlace2}** is **${timeDiff} hours**.`;

      // Edit the deferred reply with the result.
      await interaction.editReply(message);
      logger.debug("Time difference calculation completed successfully.");
    } catch (error) {
      // Log and handle any errors.
      logger.error(`Error in /timedifference command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
