const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const config = require('../config');
const { getGeocodingData, getTimezoneData } = require('../utils/locationUtils');

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

/**
 * Command module for fetching and displaying weather information.
 * Supports current conditions, forecasts, and multiple unit systems.
 * @type {Object}
 */
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
   * This function:
   * 1. Validates API configuration
   * 2. Gets location coordinates
   * 3. Fetches weather data
   * 4. Creates and sends weather embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error fetching weather data
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      logger.debug("Weather command received:", { 
        userId: interaction.user.id,
        userTag: interaction.user.tag 
      });

      if (!config.pirateWeatherApiKey) {
        logger.error("Weather API key is missing in configuration.");
        await interaction.editReply({ 
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          flags: MessageFlags.Ephemeral
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
          content: "⚠️ Failed to get coordinates for the specified location. Please try a different place name.",
          flags: MessageFlags.Ephemeral
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
          content: "⚠️ Failed to fetch weather data. Please try again later.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      
      const embed = await this.createWeatherEmbed(
        formattedAddress, 
        lat, 
        lon, 
        weatherData, 
        unitsOption, 
        forecastDays
      );
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/weather command completed successfully:", { 
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
   * 
   * @param {number} lat - Latitude coordinate
   * @param {number} lon - Longitude coordinate
   * @param {string} units - Unit system ('si' or 'us')
   * @returns {Promise<Object|null>} Weather data object or null if fetch fails
   */
  async fetchWeatherData(lat, lon, units) {
    try {
      const url = `https://api.pirateweather.net/forecast/${config.pirateWeatherApiKey}/${lat},${lon}`;
      const params = new URLSearchParams({ 
        units: units,
        extend: 'hourly'
      });
      const requestUrl = `${url}?${params.toString()}`;
      
      logger.debug("Making PirateWeather API request.", { requestUrl });
      
      const response = await axios.get(requestUrl, { timeout: 5000 });
      
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
      logger.error("Error fetching weather data from API", { 
        err: error,
        lat,
        lon
      });
      return null;
    }
  },

  /**
   * Creates a Discord embed with weather information.
   * 
   * @param {string} place - Location name
   * @param {number} lat - Latitude coordinate
   * @param {number} lon - Longitude coordinate
   * @param {Object} data - Weather data from API
   * @param {string} unitsOption - Unit system option ('metric' or 'imperial')
   * @param {number} forecastDays - Number of forecast days to display
   * @returns {Promise<EmbedBuilder>} Discord embed with weather information
   */
  async createWeatherEmbed(place, lat, lon, data, unitsOption, forecastDays) {
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
    
    const tempUnit = isMetric ? '°C' : '°F';
    const windUnit = isMetric ? 'm/s' : 'mph';
    const visibilityUnit = isMetric ? 'km' : 'mi';
    const pressureUnit = isMetric ? 'hPa' : 'inHg';
    const precipUnit = isMetric ? 'mm/hr' : 'in/hr';
    
    if (!isMetric && typeof weatherInfo.pressure === 'number') {
      weatherInfo.pressure = (weatherInfo.pressure * 0.02953).toFixed(2);
    }
    
    const windDirection = this.getWindDirection(weatherInfo.windBearing);
    
    let timezoneResult;
    try {
      timezoneResult = await getTimezoneData({ lat, lng: lon });
    } catch (error) {
      logger.warn("Failed to get timezone for location, using UTC", { 
        err: error,
        lat, 
        lon
      });
      timezoneResult = { timezoneId: null, error: true };
    }

    const forecastText = this.createForecastText(daily, unitsOption, forecastDays, timezoneResult?.timezoneId);
    
    let formattedTime;
    if (!timezoneResult.error && timezoneResult.timezoneId) {
      // Use formatted time with timezone
      formattedTime = dayjs().tz(timezoneResult.timezoneId).format('MMM D, YYYY h:mm A');
    } else {
      // Fallback to UTC
      formattedTime = dayjs().utc().format('MMM D, YYYY h:mm A UTC');
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`Weather in ${place}`)
      .setDescription(`**${weatherInfo.summary}**`)
      .setColor(0xFF6E42)
      .addFields(
        { 
          name: 'Location', 
          value: `**${place}**\nLat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`, 
          inline: false 
        },
        { 
          name: 'Temperature', 
          value: `${weatherInfo.temperature.toFixed(1)}${tempUnit}`, 
          inline: true 
        },
        { 
          name: 'Feels Like', 
          value: `${(currently.apparentTemperature || 0).toFixed(1)}${tempUnit}`, 
          inline: true 
        },
        { 
          name: 'Humidity', 
          value: `${weatherInfo.humidity.toFixed(0)}%`, 
          inline: true 
        },
        { 
          name: 'Wind Speed', 
          value: `${weatherInfo.windSpeed.toFixed(1)} ${windUnit} ${windDirection}`, 
          inline: true 
        },
        { 
          name: 'UV Index', 
          value: `${weatherInfo.uvIndex}`, 
          inline: true 
        },
        { 
          name: 'Visibility', 
          value: `${weatherInfo.visibility} ${visibilityUnit}`, 
          inline: true 
        },
        { 
          name: 'Pressure', 
          value: `${weatherInfo.pressure} ${pressureUnit}`, 
          inline: true 
        },
        { 
          name: 'Dew Point', 
          value: `${typeof weatherInfo.dewPoint === 'number' ? weatherInfo.dewPoint.toFixed(1) : weatherInfo.dewPoint}${tempUnit}`, 
          inline: true 
        },
        { 
          name: 'Cloud Cover', 
          value: `${weatherInfo.cloudCover.toFixed(0)}%`, 
          inline: true 
        },
        { 
          name: 'Precipitation', 
          value: `${weatherInfo.precipIntensity} ${precipUnit}`, 
          inline: true 
        },
        { 
          name: 'Precip. Probability', 
          value: `${weatherInfo.precipProbability.toFixed(0)}%`, 
          inline: true 
        },
        { 
          name: `${forecastDays}-Day Forecast`, 
          value: forecastText, 
          inline: false 
        }
      )
      .setFooter({ text: 'Powered by PirateWeather' });
    
    return embed;
  },

  /**
   * Creates formatted text for weather forecast.
   * 
   * @param {Array} daily - Array of daily forecast data
   * @param {string} unitsOption - Unit system option ('metric' or 'imperial')
   * @param {number} daysToShow - Number of days to show in forecast
   * @param {string} timezoneId - Timezone ID for the location
   * @returns {string} Formatted forecast text
   */
  createForecastText(daily, unitsOption, daysToShow, timezoneId) {
    let forecastText = "";
    const isMetric = unitsOption === 'metric';
    const tempUnit = isMetric ? '°C' : '°F';
    
    const days = Math.min(daysToShow, daily.length);
    
    for (let i = 0; i < days; i++) {
      const day = daily[i] || {};
      let forecastDate;
      if (day.time) {
        if (timezoneId) {
          forecastDate = dayjs.unix(day.time).tz(timezoneId).format('MM/DD/YYYY');
        } else {
          forecastDate = dayjs.unix(day.time).utc().format('MM/DD/YYYY UTC');
        }
      } else {
        forecastDate = 'Unknown date';
      }
      
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
      forecastText += `🌧 Precipitation: ${precipProb}%\n\n`;
    }
    
    return forecastText || "No forecast data available.";
  },
  
  /**
   * Gets wind direction from bearing angle.
   * 
   * @param {number} bearing - Wind bearing in degrees
   * @returns {string} Wind direction abbreviation
   */
  getWindDirection(bearing) {
    if (bearing === undefined || bearing === null) return '';
    
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((bearing % 360) / 22.5));
    return `(${directions[index % 16]})`;
  },
  
  /**
   * Handles errors that occur during command execution.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error in weather command", {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while fetching weather information. Please try again later.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to fetch weather data. Please try again later.";
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = "⚠️ Rate limit exceeded. Please try again in a few minutes.";
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    } else if (error.message === "INVALID_LOCATION") {
      errorMessage = "⚠️ Could not find the specified location. Please try a different place name.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for weather command", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  }
};