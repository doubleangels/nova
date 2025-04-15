const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const advancedFormat = require('dayjs/plugin/advancedFormat');
const config = require('../config');
const { getGeocodingData, getTimezoneData, formatErrorMessage } = require('../utils/locationUtils');

// Configuration constants.
const EMBED_COLOR = 0x1D4ED8;

// Extend dayjs with plugins.
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);

/**
 * Module for the /currenttime command.
 * Retrieves the current local time for a given place.
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
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for API calls.
      await interaction.deferReply();
      
      // Check if Google API key is configured.
      if (!this.validateConfiguration()) {
        logger.error("Google API key is not configured.");
        await interaction.editReply({ 
          content: "⚠️ Google API key is not configured. Please contact the bot administrator."
        });
        return;
      }
      
      // Retrieve the place name from the command options.
      const place = interaction.options.getString('place');
      logger.info("Current time command initiated.", { 
        userId: interaction.user.id, 
        place: place 
      });
      
      // Get location and time data
      const timeData = await this.getLocationTimeData(place);
      
      if (timeData.error) {
        await interaction.editReply({ 
          content: formatErrorMessage(place, timeData.type)
        });
        return;
      }
      
      // Build and send the embed with time information
      const embed = this.createTimeEmbed(timeData);
      await interaction.editReply({ embeds: [embed] });
      logger.info("Current time lookup successful.", { 
        userId: interaction.user.id, 
        place: place,
        timezone: timeData.timezoneName
      });
    } catch (error) {
      logger.error("Error in /currenttime command.", { 
        error: error.message,
        stack: error.stack 
      });
      await interaction.editReply({ 
        content: "⚠️ An unexpected error occurred. Please try again later."
      });
    }
  },
  
  /**
   * Validates that the required configuration is available.
   * @returns {boolean} True if configuration is valid, false otherwise.
   */
  validateConfiguration() {
    return !!config.googleApiKey;
  },
  
  /**
   * Gets location and time data for a specified place.
   * @param {string} place - The place to look up.
   * @returns {Object} An object with location and time data or an error.
   */
  async getLocationTimeData(place) {
    // Step 1: Get geocoding data for the place.
    const geocodeResult = await getGeocodingData(place);
    
    if (geocodeResult.error) {
      return geocodeResult;
    }
    
    const { location, formattedAddress } = geocodeResult;
    
    // Get the current timestamp in seconds.
    const timestamp = dayjs().unix();
    
    // Step 2: Get timezone data for the location.
    const timezoneResult = await getTimezoneData(location, timestamp);
    
    if (timezoneResult.error) {
      return timezoneResult;
    }
    
    // Extract timezone details.
    const timezoneName = timezoneResult.timezoneId;
    const rawOffset = timezoneResult.rawOffset / 3600; // Convert seconds to hours.
    const dstOffset = timezoneResult.dstOffset / 3600; // Convert seconds to hours.
    const utcOffset = rawOffset + dstOffset;   // Total UTC offset in hours.
    const isDST = dstOffset > 0 ? "Yes" : "No";
    
    // Calculate the local time by adding the UTC offset to the current UTC time.
    const localTime = dayjs.utc().add(utcOffset, 'hour');
    const formattedTime = localTime.format('YYYY-MM-DD HH:mm:ss');
    const formattedDate = localTime.format('dddd, MMMM D, YYYY');
    
    return {
      formattedAddress,
      timezoneName,
      utcOffset,
      isDST,
      localTime,
      formattedTime,
      formattedDate
    };
  },

  /**
   * Creates an embed with time information.
   * @param {Object} timeData - The time data to display.
   * @returns {EmbedBuilder} The created embed.
   */
  createTimeEmbed(timeData) {
    const {
      formattedAddress,
      timezoneName,
      utcOffset,
      isDST,
      formattedTime,
      formattedDate
    } = timeData;
    
    return new EmbedBuilder()
      .setTitle(`🕒 Current Time in ${formattedAddress}`)
      .setDescription(`⏰ **${formattedTime}**\n📅 ${formattedDate}`)
      .setColor(EMBED_COLOR)
      .addFields(
        { name: "🌍 Timezone", value: timezoneName, inline: true },
        { name: "🕰️ UTC Offset", value: `UTC ${utcOffset >= 0 ? '+' : ''}${utcOffset}`, inline: true },
        { name: "🌞 Daylight Savings", value: isDST, inline: true }
      )
      .setFooter({ text: "Powered by Google Maps Time Zone API" });
  }
};