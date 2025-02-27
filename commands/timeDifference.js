const { SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch').default; // For node-fetch v3 in CommonJS environments
const logger = require('../logger');
const config = require('../config');

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
    
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const place1 = interaction.options.getString('place1');
      const place2 = interaction.options.getString('place2');
      logger.debug(`/timedifference command received with place1: '${place1}', place2: '${place2}'`);

      async function getUtcOffset(city) {
        const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
        const geocodeParams = new URLSearchParams({
          address: city,
          key: config.googleApiKey
        });
        const geocodeResponse = await fetch(`${geocodeUrl}?${geocodeParams.toString()}`);
        const geoData = await geocodeResponse.json();
        if (geoData.results && geoData.results.length > 0) {
          const location = geoData.results[0].geometry.location;
          const lat = location.lat;
          const lng = location.lng;
          const timestamp = Math.floor(Date.now() / 1000);
          const timezoneUrl = "https://maps.googleapis.com/maps/api/timezone/json";
          const timezoneParams = new URLSearchParams({
            location: `${lat},${lng}`,
            timestamp: timestamp.toString(),
            key: config.googleApiKey
          });
          const timezoneResponse = await fetch(`${timezoneUrl}?${timezoneParams.toString()}`);
          const tzData = await timezoneResponse.json();
          if (tzData.status === "OK") {
            const rawOffset = tzData.rawOffset / 3600;
            const dstOffset = tzData.dstOffset / 3600;
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

      const offset1 = await getUtcOffset(place1);
      const offset2 = await getUtcOffset(place2);

      if (offset1 === null || offset2 === null) {
        logger.warn(`Could not retrieve timezones for '${place1}' or '${place2}'`);
        await interaction.editReply(`❌ Could not retrieve timezones for '${place1}' or '${place2}'.`);
        return;
      }

      const timeDiff = Math.abs(offset1 - offset2);
      const formattedPlace1 = place1.trim().charAt(0).toUpperCase() + place1.trim().slice(1);
      const formattedPlace2 = place2.trim().charAt(0).toUpperCase() + place2.trim().slice(1);
      const message = `⏳ The time difference between **${formattedPlace1}** and **${formattedPlace2}** is **${timeDiff} hours**.`;

      await interaction.editReply(message);
      logger.debug("Time difference calculation completed successfully.");
    } catch (error) {
      logger.error(`Error in /timedifference command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
