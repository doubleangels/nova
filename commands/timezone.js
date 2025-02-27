const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

/**
 * Module for the /timezone command.
 * This command retrieves the current local time for a given place by using
 * the Google Geocoding API to get the coordinates and then the Google Time Zone API to get the timezone information.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Get the current time in a place.')
    .addStringOption(option =>
      option
        .setName('place')
        .setDescription('Enter a place name.')
        .setRequired(true)
    ),
    
  /**
   * Executes the /timezone command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for API calls.
      await interaction.deferReply();

      // Retrieve the place name from the command options.
      const place = interaction.options.getString('place');
      logger.debug(`/timezone command received for place: '${place}'`);

      // Construct the URL for the Google Geocoding API to get coordinates for the place.
      const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
      const geocodeParams = new URLSearchParams({
        address: place,
        key: config.googleApiKey
      });
      const geocodeResponse = await fetch(`${geocodeUrl}?${geocodeParams.toString()}`);

      // Check if the Geocoding API response is successful.
      if (!geocodeResponse.ok) {
        logger.warn(`Google Geocoding API error: ${geocodeResponse.status}`);
        await interaction.editReply("⚠️ Google Geocoding API error. Try again later.");
        return;
      }
      
      // Parse the geocoding data.
      const geoData = await geocodeResponse.json();
      logger.debug(`Received Google Geocoding API response: ${JSON.stringify(geoData, null, 2)}`);

      // Ensure that at least one result was returned.
      if (!geoData.results || geoData.results.length === 0) {
        logger.warn(`No results found for city '${place}' in Geocoding API.`);
        await interaction.editReply(`❌ Could not find the city '${place}'. Check spelling.`);
        return;
      }
      
      // Extract latitude and longitude from the first result.
      const location = geoData.results[0].geometry.location;
      const lat = location.lat;
      const lng = location.lng;
      logger.debug(`Coordinates for '${place}': lat=${lat}, lng=${lng}`);

      // Get the current timestamp in seconds.
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Construct the URL for the Google Time Zone API.
      const timezoneUrl = "https://maps.googleapis.com/maps/api/timezone/json";
      const timezoneParams = new URLSearchParams({
        location: `${lat},${lng}`,
        timestamp: timestamp.toString(),
        key: config.googleApiKey
      });
      const timezoneResponse = await fetch(`${timezoneUrl}?${timezoneParams.toString()}`);

      // Check if the Time Zone API response is successful.
      if (!timezoneResponse.ok) {
        logger.warn(`Google Time Zone API error: ${timezoneResponse.status}`);
        await interaction.editReply("⚠️ Google Time Zone API error. Try again later.");
        return;
      }
      
      // Parse the timezone data.
      const tzData = await timezoneResponse.json();
      logger.debug(`Received Google Time Zone API response: ${JSON.stringify(tzData, null, 2)}`);

      // Check if the API returned a valid timezone.
      if (tzData.status !== "OK") {
        logger.warn(`Error retrieving timezone info for '${place}': ${tzData.status}`);
        await interaction.editReply(`❌ Error retrieving timezone info for '${place}'.`);
        return;
      }
      
      // Extract timezone details.
      const timezoneName = tzData.timeZoneId;
      const rawOffset = tzData.rawOffset / 3600; // Convert seconds to hours.
      const dstOffset = tzData.dstOffset / 3600;   // Convert seconds to hours.
      const utcOffset = rawOffset + dstOffset;       // Total UTC offset in hours.
      const isDST = dstOffset > 0 ? "Yes" : "No";
      
      // Calculate the local time by adding the UTC offset to the current UTC time.
      const currentUTC = new Date();
      const localTime = new Date(currentUTC.getTime() + utcOffset * 3600000);
      const formattedTime = localTime.toISOString().replace('T', ' ').split('.')[0];
      
      // Build the embed message with timezone information.
      const embed = new EmbedBuilder()
        .setTitle(`🕒 Current Time in ${place.charAt(0).toUpperCase() + place.slice(1)}`)
        .setDescription(`⏰ **${formattedTime}** (UTC ${utcOffset >= 0 ? '+' : ''}${utcOffset})`)
        .setColor(0x1D4ED8)
        .addFields(
          { name: "🌍 Timezone", value: timezoneName, inline: true },
          { name: "🕰️ UTC Offset", value: `UTC ${utcOffset >= 0 ? '+' : ''}${utcOffset}`, inline: true },
          { name: "🌞 Daylight Savings", value: isDST, inline: true }
        )
        .setFooter({ text: "Powered by Google Maps Time Zone API" });
      
      // Send the embed as the reply.
      await interaction.editReply({ embeds: [embed] });
      logger.debug("Timezone lookup successful.");
    } catch (error) {
      // Log and handle errors.
      logger.error(`Error in /timezone command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
