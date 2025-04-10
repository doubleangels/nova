const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const config = require('../config');

// Configuration constants.
const API_ENDPOINTS = {
  GEOCODING: 'https://maps.googleapis.com/maps/api/geocode/json',
  TIMEZONE: 'https://maps.googleapis.com/maps/api/timezone/json'
};
const API_STATUS = {
  SUCCESS: 'OK'
};
const EMBED_COLOR = 0x1D4ED8;
const ERROR_MESSAGES = {
  API_KEY_MISSING: '⚠️ Google API key is not configured. Please contact the bot administrator.',
  GEOCODING_API_ERROR: '⚠️ Google Geocoding API error. Try again later.',
  TIMEZONE_API_ERROR: '⚠️ Google Time Zone API error. Try again later.',
  LOCATION_NOT_FOUND: '⚠️ Could not find the location. Check spelling.',
  TIMEZONE_INFO_ERROR: '⚠️ Error retrieving timezone information.',
  GENERAL_ERROR: '⚠️ An unexpected error occurred. Please try again later.'
};

// Extend dayjs with UTC plugin.
dayjs.extend(utc);

/**
 * Module for the /currenttime command.
 * Retrieves the current local time for a given place by using
 * the Google Geocoding API to get the coordinates and then the Google Time Zone API to get the timezone information.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('currenttime')
    .setDescription('Get the current time in a place.')
    .addStringOption(option =>
      option
        .setName('place')
        .setDescription('What place do you want the time for?')
        .setRequired(true)
    ),
    
  /**
   * Executes the /currenttime command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for API calls.
      await interaction.deferReply();
      
      // Check if Google API key is configured.
      if (!config.googleApiKey) {
        logger.error("Google API key is not configured.");
        await interaction.editReply({ 
          content: ERROR_MESSAGES.API_KEY_MISSING, 
          ephemeral: true 
        });
        return;
      }
      
      // Retrieve the place name from the command options.
      const place = interaction.options.getString('place');
      logger.info("Current time command initiated.", { 
        userId: interaction.user.id, 
        place: place 
      });
      
      // Construct the URL for the Google Geocoding API to get coordinates for the place.
      const geocodeParams = new URLSearchParams({
        address: place,
        key: config.googleApiKey
      });
      
      // Fetch geocoding data using axios.
      logger.debug("Fetching geocoding data.");
      const geocodeResponse = await axios.get(`${API_ENDPOINTS.GEOCODING}?${geocodeParams.toString()}`);
      
      // Check if the Geocoding API response is successful.
      if (geocodeResponse.status !== 200) {
        logger.warn("Google Geocoding API error.", { status: geocodeResponse.status });
        await interaction.editReply({ 
          content: ERROR_MESSAGES.GEOCODING_API_ERROR, 
          ephemeral: true 
        });
        return;
      }
      
      // Parse the geocoding data.
      const geoData = geocodeResponse.data;
      
      // Ensure that at least one result was returned.
      if (!geoData.results || geoData.results.length === 0) {
        logger.warn("No geocoding results found.", { place: place });
        await interaction.editReply({ 
          content: ERROR_MESSAGES.LOCATION_NOT_FOUND, 
          ephemeral: true 
        });
        return;
      }
      
      // Extract latitude and longitude from the first result.
      const location = geoData.results[0].geometry.location;
      const lat = location.lat;
      const lng = location.lng;
      const formattedAddress = geoData.results[0].formatted_address;
      
      logger.debug("Coordinates extracted.", { 
        place: place,
        formattedAddress: formattedAddress,
        coordinates: `${lat},${lng}` 
      });

      // Get the current timestamp in seconds.
      const timestamp = dayjs().unix();
      
      // Construct the URL for the Google Time Zone API.
      const timezoneParams = new URLSearchParams({
        location: `${lat},${lng}`,
        timestamp: timestamp.toString(),
        key: config.googleApiKey
      });
      
      // Fetch timezone data using axios.
      logger.debug("Fetching timezone data.");
      const timezoneResponse = await axios.get(`${API_ENDPOINTS.TIMEZONE}?${timezoneParams.toString()}`);
      
      // Check if the Time Zone API response is successful.
      if (timezoneResponse.status !== 200) {
        logger.warn("Google Time Zone API error.", { status: timezoneResponse.status });
        await interaction.editReply({ 
          content: ERROR_MESSAGES.TIMEZONE_API_ERROR, 
          ephemeral: true 
        });
        return;
      }
      
      // Parse the timezone data.
      const tzData = timezoneResponse.data;
      
      // Check if the API returned a valid timezone.
      if (tzData.status !== API_STATUS.SUCCESS) {
        logger.warn("Error retrieving timezone info.", { 
          place: place, 
          status: tzData.status 
        });
        await interaction.editReply({ 
          content: ERROR_MESSAGES.TIMEZONE_INFO_ERROR, 
          ephemeral: true 
        });
        return;
      }
      
      // Extract timezone details.
      const timezoneName = tzData.timeZoneId;
      const rawOffset = tzData.rawOffset / 3600; // Convert seconds to hours.
      const dstOffset = tzData.dstOffset / 3600; // Convert seconds to hours.
      const utcOffset = rawOffset + dstOffset;   // Total UTC offset in hours.
      const isDST = dstOffset > 0 ? "Yes" : "No";
      
      // Calculate the local time by adding the UTC offset (in hours) to the current UTC time.
      const localTime = dayjs.utc().add(utcOffset, 'hour');
      const formattedTime = localTime.format('YYYY-MM-DD HH:mm:ss');
      
      // Build the embed message with timezone information.
      const embed = new EmbedBuilder()
        .setTitle(`🕒 Current Time in ${formattedAddress}`)
        .setDescription(`⏰ **${formattedTime}** (UTC ${utcOffset >= 0 ? '+' : ''}${utcOffset})`)
        .setColor(EMBED_COLOR)
        .addFields(
          { name: "🌍 Timezone", value: timezoneName, inline: true },
          { name: "🕰️ UTC Offset", value: `UTC ${utcOffset >= 0 ? '+' : ''}${utcOffset}`, inline: true },
          { name: "🌞 Daylight Savings", value: isDST, inline: true }
        )
        .setFooter({ text: "Powered by Google Maps Time Zone API" });
      
      // Send the embed as the reply.
      await interaction.editReply({ embeds: [embed] });
      logger.info("Current time lookup successful.", { 
        userId: interaction.user.id, 
        place: place,
        timezone: timezoneName
      });
    } catch (error) {
      logger.error("Error in /currenttime command.", { 
        error: error.message,
        stack: error.stack 
      });
      await interaction.editReply({ 
        content: ERROR_MESSAGES.GENERAL_ERROR, 
        ephemeral: true 
      });
    }
  }
};
