/**
 * Weather command module for retrieving and displaying weather information.
 * Handles API interactions with PirateWeather, location geocoding, and result formatting.
 * @module commands/weather
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');
const { getCoordinates, getGeocodingData } = require('../utils/locationUtils');
const { logError } = require('../errors');

const WEATHER_API_BASE_URL = 'https://api.pirateweather.net/forecast/';
const WEATHER_REQUEST_TIMEOUT = 5000;

const WEATHER_DATE_FORMAT = 'MM/DD/YYYY';

const WEATHER_EMBED_COLOR = 0xFF6E42;
const WEATHER_EMBED_TITLE_FORMAT = 'Weather in %s';
const WEATHER_EMBED_FOOTER = 'Powered by PirateWeather';

const WEATHER_FIELD_LOCATION = '🌍 Location';
const WEATHER_FIELD_TEMPERATURE = '🌡 Temperature';
const WEATHER_FIELD_FEELS_LIKE = '🤔 Feels Like';
const WEATHER_FIELD_HUMIDITY = '💧 Humidity';
const WEATHER_FIELD_WIND_SPEED = '💨 Wind Speed';
const WEATHER_FIELD_UV_INDEX = '🌞 UV Index';
const WEATHER_FIELD_VISIBILITY = '👀 Visibility';
const WEATHER_FIELD_PRESSURE = '🛰 Pressure';
const WEATHER_FIELD_DEW_POINT = '🌫 Dew Point';
const WEATHER_FIELD_CLOUD_COVER = '☁ Cloud Cover';
const WEATHER_FIELD_PRECIP = '🌧 Precipitation';
const WEATHER_FIELD_PRECIP_PROB = '🌧 Precip. Probability';
const WEATHER_FIELD_FORECAST = '📅 %d-Day Forecast';

const WEATHER_UNIT_TEMP_C = '°C';
const WEATHER_UNIT_TEMP_F = '°F';
const WEATHER_UNIT_PERCENTAGE = '%';
const WEATHER_UNIT_WIND_SPEED_MS = 'm/s';
const WEATHER_UNIT_WIND_SPEED_MPH = 'mph';
const WEATHER_UNIT_VISIBILITY_KM = 'km';
const WEATHER_UNIT_VISIBILITY_MI = 'mi';
const WEATHER_UNIT_PRESSURE_HPA = 'hPa';
const WEATHER_UNIT_PRESSURE_INHG = 'inHg';
const WEATHER_UNIT_PRECIP_MM = 'mm/hr';
const WEATHER_UNIT_PRECIP_IN = 'in/hr';

// Weather Icons
const WEATHER_ICONS = {
  'clear-day': '☀️',
  'clear-night': '🌙',
  'rain': '🌧️',
  'snow': '❄️',
  'sleet': '🌨️',
  'wind': '💨',
  'fog': '🌫️',
  'cloudy': '☁️',
  'partly-cloudy-day': '⛅',
  'partly-cloudy-night': '☁️🌙',
  'thunderstorm': '⛈️',
  'tornado': '🌪️',
  'default': '🌤️'
};

// Error Messages
const WEATHER_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while fetching weather information.";
const WEATHER_ERROR_CONFIG_MISSING = "⚠️ Weather API configuration is missing. Please contact an administrator.";
const WEATHER_ERROR_API = "⚠️ Failed to retrieve weather data. Please try again later.";
const WEATHER_ERROR_RATE_LIMIT = "⚠️ Weather API rate limit reached. Please try again in a few moments.";
const WEATHER_ERROR_NETWORK = "⚠️ Network error occurred. Please check your internet connection.";
const WEATHER_ERROR_ACCESS_DENIED = "⚠️ Weather API access denied. Please check API configuration.";
const WEATHER_ERROR_INVALID_LOCATION = "⚠️ Invalid location specified.";
const WEATHER_ERROR_LOCATION_NOT_FOUND = "⚠️ Could not find the specified location.";
const WEATHER_ERROR_API_ERROR = "⚠️ Failed to retrieve weather data from the API.";
const WEATHER_ERROR_INVALID_LOCATION_DATA = "⚠️ Could not find weather data for the specified location.";
const WEATHER_ERROR_REQUEST_TIMEOUT = "⚠️ The request timed out. Please try again.";
const WEATHER_ERROR_RATE_LIMIT_EXCEEDED = "⚠️ Too many requests. Please try again later.";
const WEATHER_ERROR_INVALID_UNITS = "⚠️ Invalid units specified.";
const WEATHER_ERROR_INVALID_FORECAST_DAYS = "⚠️ Invalid number of forecast days specified.";

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Get weather information for a location.')
    .addStringOption(option =>
      option
        .setName('place')
        .setDescription('What place do you want weather data for?')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('units')
        .setDescription('What units do you want to use?')
        .setRequired(false)
        .addChoices(
          { name: 'Metric (°C, m/s)', value: 'metric' },
          { name: 'Imperial (°F, mph)', value: 'imperial' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('forecast_days')
        .setDescription('What number of days do you want forecast data for? (1-7)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(7)
    ),
    
  /**
   * Executes the weather command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If weather data retrieval fails
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      logger.debug("/weather command initiated:", { 
        userId: interaction.user.id,
        userTag: interaction.user.tag 
      });

      if (!config.pirateWeatherApiKey) {
        logger.error("Weather API key is missing in configuration.");
        await interaction.editReply({ 
          content: WEATHER_ERROR_CONFIG_MISSING,
          ephemeral: true
        });
        return;
      }

      const place = interaction.options.getString('place');
      const unitsOption = interaction.options.getString('units') || 'metric';
      const forecastDays = interaction.options.getInteger('forecast_days') || 3;
      
      const units = unitsOption === 'imperial' ? 'us' : 'si';
      
      logger.debug("Processing weather request:", { 
        place, 
        units: unitsOption,
        forecastDays,
        userId: interaction.user.id 
      });
      
      const geocodeResult = await getGeocodingData(place);
      
      if (geocodeResult.error) {
        logger.warn("Failed to get coordinates for location:", { 
          place, 
          errorType: geocodeResult.type,
          userId: interaction.user.id 
        });
        
        await interaction.editReply({ 
          content: WEATHER_ERROR_INVALID_LOCATION_DATA,
          ephemeral: true
        });
        return;
      }
      
      const { location, formattedAddress } = geocodeResult;
      const { lat, lng: lon } = location;
      
      logger.debug("Location coordinates retrieved:", { 
        formattedAddress, 
        lat, 
        lon 
      });
      
      const weatherData = await this.fetchWeatherData(lat, lon, units);
      
      if (!weatherData) {
        logger.warn("Failed to fetch weather data:", { 
          place: formattedAddress, 
          lat, 
          lon 
        });
        
        await interaction.editReply({ 
          content: WEATHER_ERROR_API_ERROR,
          ephemeral: true
        });
        return;
      }
      
      const embed = this.createWeatherEmbed(
        formattedAddress, 
        lat, 
        lon, 
        weatherData, 
        unitsOption, 
        forecastDays
      );
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("Weather information sent successfully:", { 
        place: formattedAddress, 
        userId: interaction.user.id,
        units: unitsOption,
        forecastDays
      });
      
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Fetches weather data from the PirateWeather API.
   * @async
   * @function fetchWeatherData
   * @param {number} lat - Latitude of the location
   * @param {number} lon - Longitude of the location
   * @param {string} units - Units to use ('si' for metric, 'us' for imperial)
   * @returns {Promise<Object|null>} Weather data object or null if request fails
   */
  async fetchWeatherData(lat, lon, units) {
    try {
      const url = `${WEATHER_API_BASE_URL}${config.pirateWeatherApiKey}/${lat},${lon}`;
      const params = new URLSearchParams({ 
        units: units,
        extend: 'hourly'
      });
      const requestUrl = `${url}?${params.toString()}`;
      
      logger.debug("Making PirateWeather API request:", { requestUrl });
      
      const response = await axios.get(requestUrl, { timeout: WEATHER_REQUEST_TIMEOUT });
      
      if (response.status === 200) {
        logger.debug("Weather API data received successfully.");
        return response.data;
      } else {
        logger.warn("PirateWeather API returned non-200 status:", { 
          status: response.status,
          statusText: response.statusText
        });
        return null;
      }
    } catch (error) {
      logger.error("Error fetching weather data from API:", { 
        error: error.message,
        lat,
        lon
      });
      return null;
    }
  },

  /**
   * Creates an embed with weather information.
   * @function createWeatherEmbed
   * @param {string} place - Formatted place name
   * @param {number} lat - Latitude of the location
   * @param {number} lon - Longitude of the location
   * @param {Object} data - Weather data from the API
   * @param {string} unitsOption - Units preference ('metric' or 'imperial')
   * @param {number} forecastDays - Number of forecast days to show
   * @returns {EmbedBuilder} Discord embed with weather information
   */
  createWeatherEmbed(place, lat, lon, data, unitsOption, forecastDays) {
    const currently = data.currently || {};
    const daily = data.daily?.data || [];
    
    const icon = currently.icon || 'default';
    const weatherIcon = WEATHER_ICONS[icon] || WEATHER_ICONS.default;
    
    const weatherInfo = {
      summary: currently.summary || "Unknown",
      icon: icon,
      temperature: currently.temperature ?? 0,
      humidity: (currently.humidity ?? 0) * 100,
      windSpeed: currently.windSpeed ?? 0,
      windBearing: currently.windBearing ?? 0,
      uvIndex: currently.uvIndex ?? "N/A",
      visibility: currently.visibility ?? "N/A",
      pressure: currently.pressure ?? "N/A",
      dewPoint: currently.dewPoint !== undefined ? currently.dewPoint : "N/A",
      cloudCover: (currently.cloudCover ?? 0) * 100,
      precipIntensity: currently.precipIntensity ?? 0,
      precipProbability: (currently.precipProbability ?? 0) * 100
    };

    const isMetric = unitsOption === 'metric';
    
    const tempUnit = isMetric ? WEATHER_UNIT_TEMP_C : WEATHER_UNIT_TEMP_F;
    const windUnit = isMetric ? WEATHER_UNIT_WIND_SPEED_MS : WEATHER_UNIT_WIND_SPEED_MPH;
    const visibilityUnit = isMetric ? WEATHER_UNIT_VISIBILITY_KM : WEATHER_UNIT_VISIBILITY_MI;
    const pressureUnit = isMetric ? WEATHER_UNIT_PRESSURE_HPA : WEATHER_UNIT_PRESSURE_INHG;
    const precipUnit = isMetric ? WEATHER_UNIT_PRECIP_MM : WEATHER_UNIT_PRECIP_IN;
    
    if (!isMetric && typeof weatherInfo.pressure === 'number') {
      weatherInfo.pressure = (weatherInfo.pressure * 0.02953).toFixed(2);
    }
    
    const windDirection = this.getWindDirection(weatherInfo.windBearing);
    
    const forecastText = this.createForecastText(daily, unitsOption, forecastDays);
    
    const timestamp = new Date();
    const formattedTime = timestamp.toLocaleString();
    
    const embed = new EmbedBuilder()
      .setTitle(`${weatherIcon} ${WEATHER_EMBED_TITLE_FORMAT.replace('%s', place)}`)
      .setDescription(`**${weatherInfo.summary}**`)
      .setColor(WEATHER_EMBED_COLOR)
      .addFields(
        { 
          name: WEATHER_FIELD_LOCATION, 
          value: `📍 ${place}\n📍 Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`, 
          inline: false 
        },
        { 
          name: WEATHER_FIELD_TEMPERATURE, 
          value: `${weatherInfo.temperature.toFixed(1)}${tempUnit}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_FEELS_LIKE, 
          value: `${(currently.apparentTemperature || 0).toFixed(1)}${tempUnit}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_HUMIDITY, 
          value: `${weatherInfo.humidity.toFixed(0)}${WEATHER_UNIT_PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_WIND_SPEED, 
          value: `${weatherInfo.windSpeed.toFixed(1)} ${windUnit} ${windDirection}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_UV_INDEX, 
          value: `${weatherInfo.uvIndex}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_VISIBILITY, 
          value: `${weatherInfo.visibility} ${visibilityUnit}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_PRESSURE, 
          value: `${weatherInfo.pressure} ${pressureUnit}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_DEW_POINT, 
          value: `${typeof weatherInfo.dewPoint === 'number' ? weatherInfo.dewPoint.toFixed(1) : weatherInfo.dewPoint}${tempUnit}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_CLOUD_COVER, 
          value: `${weatherInfo.cloudCover.toFixed(0)}${WEATHER_UNIT_PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_PRECIP, 
          value: `${weatherInfo.precipIntensity} ${precipUnit}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_PRECIP_PROB, 
          value: `${weatherInfo.precipProbability.toFixed(0)}${WEATHER_UNIT_PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_FORECAST.replace('%d', forecastDays), 
          value: forecastText, 
          inline: false 
        }
      )
      .setFooter({ text: `${WEATHER_EMBED_FOOTER} • Data as of ${formattedTime}` })
      .setTimestamp();
    
    return embed;
  },

  /**
   * Creates a formatted forecast text for the given daily weather data.
   * @function createForecastText
   * @param {Array} daily - Array of daily forecast data
   * @param {string} unitsOption - Units preference ('metric' or 'imperial')
   * @param {number} daysToShow - Number of forecast days to show
   * @returns {string} Formatted forecast text
   */
  createForecastText(daily, unitsOption, daysToShow) {
    let forecastText = "";
    const isMetric = unitsOption === 'metric';
    const tempUnit = isMetric ? WEATHER_UNIT_TEMP_C : WEATHER_UNIT_TEMP_F;
    
    const days = Math.min(daysToShow, daily.length);
    
    for (let i = 0; i < days; i++) {
      const day = daily[i] || {};
      const forecastDate = day.time ? 
        dayjs.unix(day.time).format(WEATHER_DATE_FORMAT) : 
        'Unknown date';
      
      const daySummary = day.summary || "No data";
      
      const icon = day.icon || 'default';
      const weatherIcon = WEATHER_ICONS[icon] || WEATHER_ICONS.default;
      
      const highTemp = typeof day.temperatureHigh === "number" ? 
        day.temperatureHigh.toFixed(1) : 
        "N/A";
      
      const lowTemp = typeof day.temperatureLow === "number" ? 
        day.temperatureLow.toFixed(1) : 
        "N/A";
      
      const precipProb = typeof day.precipProbability === "number" ? 
        (day.precipProbability * 100).toFixed(0) : 
        "0";
      
      forecastText += `**${forecastDate}** ${weatherIcon}\n`;
      forecastText += `${daySummary}\n`;
      forecastText += `🌡 High: ${highTemp}${tempUnit}, Low: ${lowTemp}${tempUnit}\n`;
      forecastText += `🌧 Precipitation: ${precipProb}${WEATHER_UNIT_PERCENTAGE}\n\n`;
    }
    
    return forecastText || "No forecast data available.";
  },
  
  /**
   * Gets a cardinal direction from a wind bearing in degrees.
   * @function getWindDirection
   * @param {number} bearing - Wind bearing in degrees
   * @returns {string} Cardinal direction
   */
  getWindDirection(bearing) {
    if (bearing === undefined || bearing === null) return '';
    
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((bearing % 360) / 22.5));
    return `(${directions[index % 16]})`;
  },
  
  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'weather', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = WEATHER_ERROR_UNEXPECTED;
    
    if (error.message === "API_ERROR") {
      errorMessage = WEATHER_ERROR_API;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = WEATHER_ERROR_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = WEATHER_ERROR_NETWORK;
    } else if (error.message === "INVALID_LOCATION") {
      errorMessage = WEATHER_ERROR_INVALID_LOCATION;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = WEATHER_ERROR_REQUEST_TIMEOUT;
    } else if (error.response?.status === 403) {
      errorMessage = WEATHER_ERROR_ACCESS_DENIED;
    } else if (error.response?.status === 429) {
      errorMessage = WEATHER_ERROR_RATE_LIMIT_EXCEEDED;
    } else if (error.response?.status >= 500) {
      errorMessage = WEATHER_ERROR_API;
    } else if (error.message === "INVALID_UNITS") {
      errorMessage = WEATHER_ERROR_INVALID_UNITS;
    } else if (error.message === "INVALID_FORECAST_DAYS") {
      errorMessage = WEATHER_ERROR_INVALID_FORECAST_DAYS;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for weather command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
      });
    }
  }
};