const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
const config = require('../config');

/**
 * Module for the /timezone command.
 * Retrieves the current local time for a given place by using
 * the Google Geocoding API to get the coordinates and then the Google Time Zone API to get the timezone information.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Get the current time in a place.')
    .addStringOption(option =>
      option
        .setName('place')
        .setDescription('What place do you want the time for?')
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
      logger.debug("/timezone command received:", { user: interaction.user.tag, place });
      
      // Construct the URL for the Google Geocoding API to get coordinates for the place.
      const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
      const geocodeParams = new URLSearchParams({
        address: place,
        key: config.googleApiKey
      });
      const geocodeRequestUrl = `${geocodeUrl}?${geocodeParams.toString()}`;
      logger.debug("Fetching geocoding data:", { requestUrl: geocodeRequestUrl });
      
      // Fetch geocoding data using axios.
      const geocodeResponse = await axios.get(geocodeRequestUrl);
      
      // Check if the Geocoding API response is successful.
      if (geocodeResponse.status !== 200) {
        logger.warn("Google Geocoding API error:", { status: geocodeResponse.status });
        await interaction.editReply({ 
          content: "⚠️ Google Geocoding API error. Try again later.", 
          ephemeral: true 
        });
        return;
      }
      
      // Parse the geocoding data.
      const geoData = geocodeResponse.data;
      logger.debug("Received geocoding data:", { geoData });
      
      // Ensure that at least one result was returned.
      if (!geoData.results || geoData.results.length === 0) {
        logger.warn("No geocoding results found:", { place });
        await interaction.editReply({ 
          content: `⚠️ Could not find the city '${place}'. Check spelling.`, 
          ephemeral: true 
        });
        return;
      }
      
      // Extract latitude and longitude from the first result.
      const location = geoData.results[0].geometry.location;
      const lat = location.lat;
      const lng = location.lng;
      logger.debug("Extracted coordinates:", { place, lat, lng });

      // Get the current timestamp in seconds using day.js.
      const timestamp = dayjs().unix();
      
      // Construct the URL for the Google Time Zone API.
      const timezoneUrl = "https://maps.googleapis.com/maps/api/timezone/json";
      const timezoneParams = new URLSearchParams({
        location: `${lat},${lng}`,
        timestamp: timestamp.toString(),
        key: config.googleApiKey
      });
      const timezoneRequestUrl = `${timezoneUrl}?${timezoneParams.toString()}`;
      logger.debug("Fetching timezone data:", { requestUrl: timezoneRequestUrl });
      
      // Fetch timezone data using axios.
      const timezoneResponse = await axios.get(timezoneRequestUrl);
      
      // Check if the Time Zone API response is successful.
      if (timezoneResponse.status !== 200) {
        logger.warn("Google Time Zone API error:", { status: timezoneResponse.status });
        await interaction.editReply({ 
          content: "⚠️ Google Time Zone API error. Try again later.", 
          ephemeral: true 
        });
        return;
      }
      
      // Parse the timezone data.
      const tzData = timezoneResponse.data;
      logger.debug("Received timezone data:", { tzData });
      
      // Check if the API returned a valid timezone.
      if (tzData.status !== "OK") {
        logger.warn("Error retrieving timezone info:", { place, status: tzData.status });
        await interaction.editReply({ 
          content: `⚠️ Error retrieving timezone info for '${place}'.`, 
          ephemeral: true 
        });
        return;
      }
      
      // Extract timezone details.
      const timezoneName = tzData.timeZoneId;
      const rawOffset = tzData.rawOffset / 3600; // Convert seconds to hours.
      const dstOffset = tzData.dstOffset / 3600;   // Convert seconds to hours.
      const utcOffset = rawOffset + dstOffset;       // Total UTC offset in hours.
      const isDST = dstOffset > 0 ? "Yes" : "No";
      
      // Calculate the local time by adding the UTC offset (in hours) to the current UTC time using day.js.
      const localTime = dayjs.utc().add(utcOffset, 'hour');
      const formattedTime = localTime.format('YYYY-MM-DD HH:mm:ss');
      
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
      logger.debug("Timezone lookup successful:", { place, localTime: formattedTime, utcOffset });
    } catch (error) {
      logger.error("Error in /timezone command:", { error });
      await interaction.editReply({ 
        content: "⚠️ An unexpected error occurred. Please try again later.", 
        ephemeral: true 
      });
    }
  }
};
