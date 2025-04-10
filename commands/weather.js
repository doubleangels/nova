/**
 * Module for the /weather command.
 * 
 * Retrieves the current weather for a specified place using the PirateWeather API.
 * It first obtains the coordinates of the place using a helper function and then fetches the weather data.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');
const { getCoordinates } = require('../utils/locationUtils');

// Configuration constants.
const WEATHER_CONFIG = {
  COMMAND: {
    NAME: 'weather',
    DESCRIPTION: 'Get the current weather for a place.'
  },
  OPTIONS: {
    PLACE: {
      NAME: 'place',
      DESCRIPTION: 'What place do you want weather data for?'
    }
  },
  API: {
    BASE_URL: 'https://api.pirateweather.net/forecast/',
    UNITS: 'si',
    DAYS_FORECAST: 3
  },
  EMBED: {
    COLOR: 0xFF6E42,
    TITLE: 'Weather in %s',
    FOOTER: 'Powered by PirateWeather'
  },
  FIELDS: {
    LOCATION: '🌍 Location',
    TEMPERATURE: '🌡 Temperature',
    FEELS_LIKE: '🤔 Feels Like',
    HUMIDITY: '💧 Humidity',
    WIND_SPEED: '💨 Wind Speed',
    UV_INDEX: '🌞 UV Index',
    VISIBILITY: '👀 Visibility',
    PRESSURE: '🛰 Pressure',
    DEW_POINT: '🌫 Dew Point',
    CLOUD_COVER: '☁ Cloud Cover',
    PRECIP: '🌧 Precipitation',
    PRECIP_PROB: '🌧 Precip. Probability',
    FORECAST: '📅 3-Day Forecast'
  },
  RESPONSES: {
    LOCATION_NOT_FOUND: '⚠️ Could not find the location for \'%s\'. Try another city.',
    API_ERROR: '⚠️ Error: PirateWeather API returned status code %s.',
    GENERAL_ERROR: '⚠️ An unexpected error occurred. Please try again later.',
    API_KEY_MISSING: '⚠️ Weather API key is not configured. Please contact the bot administrator.'
  },
  DEFAULTS: {
    SUMMARY: 'Unknown',
    TEMP: 0,
    HUMIDITY: 0,
    WIND_SPEED: 0,
    UV_INDEX: 'N/A',
    VISIBILITY: 'N/A',
    PRESSURE: 'N/A',
    DEW_POINT: 'N/A',
    CLOUD_COVER: 0,
    PRECIP_INTENSITY: 0,
    PRECIP_PROBABILITY: 0
  },
  UNITS: {
    TEMP_C: '°C',
    TEMP_F: '°F',
    PERCENTAGE: '%',
    WIND_SPEED: 'm/s',
    VISIBILITY: 'km',
    PRESSURE: 'hPa',
    PRECIP: 'mm/hr'
  },
  DATE_FORMAT: 'MM/DD/YYYY'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName(WEATHER_CONFIG.COMMAND.NAME)
    .setDescription(WEATHER_CONFIG.COMMAND.DESCRIPTION)
    .addStringOption(option =>
      option
        .setName(WEATHER_CONFIG.OPTIONS.PLACE.NAME)
        .setDescription(WEATHER_CONFIG.OPTIONS.PLACE.DESCRIPTION)
        .setRequired(true)
    ),
    
  /**
   * Executes the /weather command.
   * 
   * @param {Interaction} interaction - The Discord interaction object.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for processing and API calls.
      await interaction.deferReply();
      
      logger.debug("Weather command received.", { 
        userId: interaction.user.id,
        userTag: interaction.user.tag 
      });

      // Check if API key is configured.
      if (!config.pirateWeatherApiKey) {
        logger.error("Weather API key is missing in configuration.");
        await interaction.editReply({ 
          content: WEATHER_CONFIG.RESPONSES.API_KEY_MISSING, 
          ephemeral: true 
        });
        return;
      }

      // Retrieve the 'place' option provided by the user.
      const place = interaction.options.getString(WEATHER_CONFIG.OPTIONS.PLACE.NAME);
      
      logger.debug("Processing weather request.", { 
        place, 
        userId: interaction.user.id 
      });
      
      // Get the latitude and longitude for the provided place using a helper function.
      const [lat, lon] = await getCoordinates(place);
      
      if (lat === null || lon === null) {
        logger.warn("Failed to get coordinates for location.", { 
          place, 
          userId: interaction.user.id 
        });
        
        await interaction.editReply({ 
          content: WEATHER_CONFIG.RESPONSES.LOCATION_NOT_FOUND.replace('%s', place), 
          ephemeral: true 
        });
        return;
      }
      
      // Format the place name for display (capitalize each word).
      const formattedPlace = this.formatPlaceName(place);
      
      logger.debug("Location coordinates retrieved.", { 
        formattedPlace, 
        lat, 
        lon 
      });
      
      // Build the PirateWeather API URL using the coordinates.
      const weatherData = await this.fetchWeatherData(lat, lon);
      
      if (!weatherData) {
        logger.warn("Failed to fetch weather data.", { 
          place: formattedPlace, 
          lat, 
          lon 
        });
        
        await interaction.editReply({ 
          content: WEATHER_CONFIG.RESPONSES.GENERAL_ERROR, 
          ephemeral: true 
        });
        return;
      }
      
      // Create an embed with the weather data.
      const embed = this.createWeatherEmbed(formattedPlace, lat, lon, weatherData);
      
      // Send the embed as the reply.
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Weather information sent successfully.", { 
        place: formattedPlace, 
        userId: interaction.user.id 
      });
      
    } catch (error) {
      // Log any unexpected errors and send an error message to the user.
      logger.error("Error executing weather command.", { 
        error: error.message, 
        stack: error.stack,
        userId: interaction.user?.id 
      });
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ 
          content: WEATHER_CONFIG.RESPONSES.GENERAL_ERROR, 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: WEATHER_CONFIG.RESPONSES.GENERAL_ERROR, 
          ephemeral: true 
        });
      }
    }
  },

  /**
   * Formats a place name by capitalizing each word.
   * 
   * @param {string} place - The place name to format.
   * @returns {string} - The formatted place name.
   */
  formatPlaceName(place) {
    return place.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  },

  /**
   * Fetches weather data from the PirateWeather API.
   * 
   * @param {number} lat - Latitude of the location.
   * @param {number} lon - Longitude of the location.
   * @returns {Object|null} - Weather data object or null if the request failed.
   */
  async fetchWeatherData(lat, lon) {
    try {
      // Build the PirateWeather API URL using the coordinates.
      const url = `${WEATHER_CONFIG.API.BASE_URL}${config.pirateWeatherApiKey}/${lat},${lon}`;
      // Set additional parameters; here, we're using SI units.
      const params = new URLSearchParams({ units: WEATHER_CONFIG.API.UNITS });
      const requestUrl = `${url}?${params.toString()}`;
      
      logger.debug("Making PirateWeather API request.", { requestUrl });
      
      // Fetch weather data from PirateWeather using axios.
      const response = await axios.get(requestUrl, { timeout: 5000 });
      
      if (response.status === 200) {
        logger.debug("Weather API data received successfully.");
        return response.data;
      } else {
        logger.warn("PirateWeather API returned non-200 status.", { 
          status: response.status,
          statusText: response.statusText
        });
        return null;
      }
    } catch (error) {
      logger.error("Error fetching weather data from API.", { 
        error: error.message,
        lat,
        lon
      });
      return null;
    }
  },

  /**
   * Creates an embed with weather information.
   * 
   * @param {string} place - Formatted place name.
   * @param {number} lat - Latitude of the location.
   * @param {number} lon - Longitude of the location.
   * @param {Object} data - Weather data from the API.
   * @returns {EmbedBuilder} - Discord embed with weather information.
   */
  createWeatherEmbed(place, lat, lon, data) {
    // Extract current weather details from the response.
    const currently = data.currently || {};
    // Get daily forecast data.
    const daily = data.daily?.data || [];
    
    // Extract weather information with defaults for missing data.
    const weatherInfo = {
      summary: currently.summary || WEATHER_CONFIG.DEFAULTS.SUMMARY,
      tempC: currently.temperature ?? WEATHER_CONFIG.DEFAULTS.TEMP,
      humidity: (currently.humidity ?? WEATHER_CONFIG.DEFAULTS.HUMIDITY) * 100,
      windSpeed: currently.windSpeed ?? WEATHER_CONFIG.DEFAULTS.WIND_SPEED,
      uvIndex: currently.uvIndex ?? WEATHER_CONFIG.DEFAULTS.UV_INDEX,
      visibility: currently.visibility ?? WEATHER_CONFIG.DEFAULTS.VISIBILITY,
      pressure: currently.pressure ?? WEATHER_CONFIG.DEFAULTS.PRESSURE,
      dewPointC: currently.dewPoint !== undefined ? currently.dewPoint : WEATHER_CONFIG.DEFAULTS.DEW_POINT,
      cloudCover: (currently.cloudCover ?? WEATHER_CONFIG.DEFAULTS.CLOUD_COVER) * 100,
      precipIntensity: currently.precipIntensity ?? WEATHER_CONFIG.DEFAULTS.PRECIP_INTENSITY,
      precipProbability: (currently.precipProbability ?? WEATHER_CONFIG.DEFAULTS.PRECIP_PROBABILITY) * 100
    };

    // Calculate Fahrenheit values from Celsius.
    const tempF = typeof weatherInfo.tempC === 'number' ? 
      Math.round((weatherInfo.tempC * 9/5) + 32) : 
      WEATHER_CONFIG.DEFAULTS.TEMP;
    
    const feelsLikeC = currently.apparentTemperature ?? WEATHER_CONFIG.DEFAULTS.TEMP;
    const feelsLikeF = typeof feelsLikeC === 'number' ? 
      Math.round((feelsLikeC * 9/5) + 32) : 
      WEATHER_CONFIG.DEFAULTS.TEMP;
    
    const dewPointF = typeof weatherInfo.dewPointC === 'number' ? 
      Math.round((weatherInfo.dewPointC * 9/5) + 32) : 
      WEATHER_CONFIG.DEFAULTS.DEW_POINT;
    
    // Build a forecast text for the next 3 days (or available days if less than 3).
    const forecastText = this.createForecastText(daily);
    
    // Create an embed to display the weather data.
    const embed = new EmbedBuilder()
      .setTitle(WEATHER_CONFIG.EMBED.TITLE.replace('%s', place))
      .setDescription(`**${weatherInfo.summary}**`)
      .setColor(WEATHER_CONFIG.EMBED.COLOR)
      .addFields(
        { 
          name: WEATHER_CONFIG.FIELDS.LOCATION, 
          value: `📍 ${place}\n📍 Lat: ${lat}, Lon: ${lon}`, 
          inline: false 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.TEMPERATURE, 
          value: `${weatherInfo.tempC}${WEATHER_CONFIG.UNITS.TEMP_C} / ${tempF}${WEATHER_CONFIG.UNITS.TEMP_F}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.FEELS_LIKE, 
          value: `${feelsLikeC}${WEATHER_CONFIG.UNITS.TEMP_C} / ${feelsLikeF}${WEATHER_CONFIG.UNITS.TEMP_F}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.HUMIDITY, 
          value: `${weatherInfo.humidity}${WEATHER_CONFIG.UNITS.PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.WIND_SPEED, 
          value: `${weatherInfo.windSpeed} ${WEATHER_CONFIG.UNITS.WIND_SPEED}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.UV_INDEX, 
          value: `${weatherInfo.uvIndex}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.VISIBILITY, 
          value: `${weatherInfo.visibility} ${WEATHER_CONFIG.UNITS.VISIBILITY}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.PRESSURE, 
          value: `${weatherInfo.pressure} ${WEATHER_CONFIG.UNITS.PRESSURE}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.DEW_POINT, 
          value: `${weatherInfo.dewPointC}${WEATHER_CONFIG.UNITS.TEMP_C} / ${dewPointF}${WEATHER_CONFIG.UNITS.TEMP_F}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.CLOUD_COVER, 
          value: `${weatherInfo.cloudCover}${WEATHER_CONFIG.UNITS.PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.PRECIP, 
          value: `${weatherInfo.precipIntensity} ${WEATHER_CONFIG.UNITS.PRECIP}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.PRECIP_PROB, 
          value: `${weatherInfo.precipProbability}${WEATHER_CONFIG.UNITS.PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_CONFIG.FIELDS.FORECAST, 
          value: forecastText, 
          inline: false 
        }
      )
      .setFooter({ text: WEATHER_CONFIG.EMBED.FOOTER });
    
    return embed;
  },

  /**
   * Creates a formatted forecast text for the given daily weather data.
   * 
   * @param {Array} daily - Array of daily forecast data.
   * @returns {string} - Formatted forecast text.
   */
  createForecastText(daily) {
    let forecastText = "";
    const daysToShow = Math.min(WEATHER_CONFIG.API.DAYS_FORECAST, daily.length);
    
    for (let i = 0; i < daysToShow; i++) {
      const day = daily[i] || {};
      const forecastDate = day.time ? 
        dayjs.unix(day.time).format(WEATHER_CONFIG.DATE_FORMAT) : 
        'Unknown date';
      
      const daySummary = day.summary || "No data";
      
      const highC = typeof day.temperatureHigh === "number" ? 
        day.temperatureHigh : 
        WEATHER_CONFIG.DEFAULTS.TEMP;
      
      const highF = typeof highC === "number" ? 
        Math.round((highC * 9/5) + 32) : 
        WEATHER_CONFIG.DEFAULTS.TEMP;
      
      const lowC = typeof day.temperatureLow === "number" ? 
        day.temperatureLow : 
        WEATHER_CONFIG.DEFAULTS.TEMP;
      
      const lowF = typeof lowC === "number" ? 
        Math.round((lowC * 9/5) + 32) : 
        WEATHER_CONFIG.DEFAULTS.TEMP;
      
      forecastText += `**${forecastDate}**\n`;
      forecastText += `**${daySummary}**\n`;
      forecastText += `🌡 High: ${highC}${WEATHER_CONFIG.UNITS.TEMP_C} / `;
      forecastText += `${highF}${WEATHER_CONFIG.UNITS.TEMP_F}, Low: `;
      forecastText += `${lowC}${WEATHER_CONFIG.UNITS.TEMP_C} / `;
      forecastText += `${lowF}${WEATHER_CONFIG.UNITS.TEMP_F}\n\n`;
    }
    
    return forecastText || "No forecast data available.";
  }
};
