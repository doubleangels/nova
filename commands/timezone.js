const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Get the current time in a place.')
    .addStringOption(option =>
      option.setName('place')
            .setDescription('Enter a place name.')
            .setRequired(true)
    ),
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const place = interaction.options.getString('place');
      logger.debug(`/timezone command received for place: '${place}'`);
      
      const geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json";
      const geocodeParams = new URLSearchParams({
        address: place,
        key: config.googleApiKey
      });
      const geocodeResponse = await fetch(`${geocodeUrl}?${geocodeParams.toString()}`);
      if (!geocodeResponse.ok) {
        logger.warn(`Google Geocoding API error: ${geocodeResponse.status}`);
        await interaction.editReply("⚠️ Google Geocoding API error. Try again later.");
        return;
      }
      const geoData = await geocodeResponse.json();
      logger.debug(`Received Google Geocoding API response: ${JSON.stringify(geoData, null, 2)}`);
      
      if (!geoData.results || geoData.results.length === 0) {
        logger.warn(`No results found for city '${place}' in Geocoding API.`);
        await interaction.editReply(`❌ Could not find the city '${place}'. Check spelling.`);
        return;
      }
      
      const location = geoData.results[0].geometry.location;
      const lat = location.lat;
      const lng = location.lng;
      logger.debug(`Coordinates for '${place}': lat=${lat}, lng=${lng}`);
      
      const timestamp = Math.floor(Date.now() / 1000);
      
      const timezoneUrl = "https://maps.googleapis.com/maps/api/timezone/json";
      const timezoneParams = new URLSearchParams({
        location: `${lat},${lng}`,
        timestamp: timestamp.toString(),
        key: config.googleApiKey
      });
      const timezoneResponse = await fetch(`${timezoneUrl}?${timezoneParams.toString()}`);
      if (!timezoneResponse.ok) {
        logger.warn(`Google Time Zone API error: ${timezoneResponse.status}`);
        await interaction.editReply("⚠️ Google Time Zone API error. Try again later.");
        return;
      }
      
      const tzData = await timezoneResponse.json();
      logger.debug(`Received Google Time Zone API response: ${JSON.stringify(tzData, null, 2)}`);
      if (tzData.status !== "OK") {
        logger.warn(`Error retrieving timezone info for '${place}': ${tzData.status}`);
        await interaction.editReply(`❌ Error retrieving timezone info for '${place}'.`);
        return;
      }
      
      const timezoneName = tzData.timeZoneId;
      const rawOffset = tzData.rawOffset / 3600;
      const dstOffset = tzData.dstOffset / 3600;
      const utcOffset = rawOffset + dstOffset;
      const isDST = dstOffset > 0 ? "Yes" : "No";
      
      const currentUTC = new Date();
      const localTime = new Date(currentUTC.getTime() + utcOffset * 3600000);
      const formattedTime = localTime.toISOString().replace('T', ' ').split('.')[0];
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
      
      await interaction.editReply({ embeds: [embed] });
      logger.debug("Timezone lookup successful.");
    } catch (error) {
      logger.error(`Error in /timezone command: ${error}`);
      await interaction.editReply({ content: "⚠️ An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
