const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');
const { getCoordinates } = require('../utils/locationUtils');

// Configuration constants.
const WEATHER_API_BASE_URL = 'https://api.pirateweather.net/forecast/';
const WEATHER_API_UNITS = 'si';
const WEATHER_FORECAST_DAYS = 3;
const WEATHER_EMBED_COLOR = 0xFF6E42;
const WEATHER_EMBED_TITLE_FORMAT = 'Weather in %s';
const WEATHER_EMBED_FOOTER = 'Powered by PirateWeather';
const WEATHER_DATE_FORMAT = 'MM/DD/YYYY';

// Field names.
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
const WEATHER_FIELD_FORECAST = '📅 3-Day Forecast';

// Units.
const WEATHER_UNIT_TEMP_C = '°C';
const WEATHER_UNIT_TEMP_F = '°F';
const WEATHER_UNIT_PERCENTAGE = '%';
const WEATHER_UNIT_WIND_SPEED = 'm/s';
const WEATHER_UNIT_VISIBILITY = 'km';
const WEATHER_UNIT_PRESSURE = 'hPa';
const WEATHER_UNIT_PRECIP = 'mm/hr';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Get the current weather for a place.')
    .addStringOption(option =>
      option
        .setName('place')
        .setDescription('What place do you want weather data for?')
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
          content: '⚠️ Weather API key is not configured. Please contact the bot administrator.', 
          ephemeral: true 
        });
        return;
      }

      // Retrieve the 'place' option provided by the user.
      const place = interaction.options.getString('place');
      
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
          content: `⚠️ Could not find the location for '${place}'. Try another city.`, 
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
          content: '⚠️ An unexpected error occurred. Please try again later.', 
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
          content: '⚠️ An unexpected error occurred. Please try again later.', 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: '⚠️ An unexpected error occurred. Please try again later.', 
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
      const url = `${WEATHER_API_BASE_URL}${config.pirateWeatherApiKey}/${lat},${lon}`;
      // Set additional parameters; here, we're using SI units.
      const params = new URLSearchParams({ units: WEATHER_API_UNITS });
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
      summary: currently.summary || "Unknown",
      tempC: currently.temperature ?? 0,
      humidity: (currently.humidity ?? 0) * 100,
      windSpeed: currently.windSpeed ?? 0,
      uvIndex: currently.uvIndex ?? "N/A",
      visibility: currently.visibility ?? "N/A",
      pressure: currently.pressure ?? "N/A",
      dewPointC: currently.dewPoint !== undefined ? currently.dewPoint : "N/A",
      cloudCover: (currently.cloudCover ?? 0) * 100,
      precipIntensity: currently.precipIntensity ?? 0,
      precipProbability: (currently.precipProbability ?? 0) * 100
    };

    // Calculate Fahrenheit values from Celsius.
    const tempF = typeof weatherInfo.tempC === 'number' ? 
      Math.round((weatherInfo.tempC * 9/5) + 32) : 
      0;
    
    const feelsLikeC = currently.apparentTemperature ?? 0;
    const feelsLikeF = typeof feelsLikeC === 'number' ? 
      Math.round((feelsLikeC * 9/5) + 32) : 
      0;
    
    const dewPointF = typeof weatherInfo.dewPointC === 'number' ? 
      Math.round((weatherInfo.dewPointC * 9/5) + 32) : 
      "N/A";
    
    // Build a forecast text for the next 3 days (or available days if less than 3).
    const forecastText = this.createForecastText(daily);
    
    // Create an embed to display the weather data.
    const embed = new EmbedBuilder()
      .setTitle(WEATHER_EMBED_TITLE_FORMAT.replace('%s', place))
      .setDescription(`**${weatherInfo.summary}**`)
      .setColor(WEATHER_EMBED_COLOR)
      .addFields(
        { 
          name: WEATHER_FIELD_LOCATION, 
          value: `📍 ${place}\n📍 Lat: ${lat}, Lon: ${lon}`, 
          inline: false 
        },
        { 
          name: WEATHER_FIELD_TEMPERATURE, 
          value: `${weatherInfo.tempC}${WEATHER_UNIT_TEMP_C} / ${tempF}${WEATHER_UNIT_TEMP_F}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_FEELS_LIKE, 
          value: `${feelsLikeC}${WEATHER_UNIT_TEMP_C} / ${feelsLikeF}${WEATHER_UNIT_TEMP_F}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_HUMIDITY, 
          value: `${weatherInfo.humidity}${WEATHER_UNIT_PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_WIND_SPEED, 
          value: `${weatherInfo.windSpeed} ${WEATHER_UNIT_WIND_SPEED}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_UV_INDEX, 
          value: `${weatherInfo.uvIndex}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_VISIBILITY, 
          value: `${weatherInfo.visibility} ${WEATHER_UNIT_VISIBILITY}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_PRESSURE, 
          value: `${weatherInfo.pressure} ${WEATHER_UNIT_PRESSURE}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_DEW_POINT, 
          value: `${weatherInfo.dewPointC}${WEATHER_UNIT_TEMP_C} / ${dewPointF}${WEATHER_UNIT_TEMP_F}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_CLOUD_COVER, 
          value: `${weatherInfo.cloudCover}${WEATHER_UNIT_PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_PRECIP, 
          value: `${weatherInfo.precipIntensity} ${WEATHER_UNIT_PRECIP}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_PRECIP_PROB, 
          value: `${weatherInfo.precipProbability}${WEATHER_UNIT_PERCENTAGE}`, 
          inline: true 
        },
        { 
          name: WEATHER_FIELD_FORECAST, 
          value: forecastText, 
          inline: false 
        }
      )
      .setFooter({ text: WEATHER_EMBED_FOOTER });
    
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
    const daysToShow = Math.min(WEATHER_FORECAST_DAYS, daily.length);
    
    for (let i = 0; i < daysToShow; i++) {
      const day = daily[i] || {};
      const forecastDate = day.time ? 
        dayjs.unix(day.time).format(WEATHER_DATE_FORMAT) : 
        'Unknown date';
      
      const daySummary = day.summary || "No data";
      
      const highC = typeof day.temperatureHigh === "number" ? 
        day.temperatureHigh : 
        0;
      
      const highF = typeof highC === "number" ? 
        Math.round((highC * 9/5) + 32) : 
        0;
      
      const lowC = typeof day.temperatureLow === "number" ? 
        day.temperatureLow : 
        0;
      
      const lowF = typeof lowC === "number" ? 
        Math.round((lowC * 9/5) + 32) : 
        0;
      
      forecastText += `**${forecastDate}**\n`;
      forecastText += `**${daySummary}**\n`;
      forecastText += `🌡 High: ${highC}${WEATHER_UNIT_TEMP_C} / `;
      forecastText += `${highF}${WEATHER_UNIT_TEMP_F}, Low: `;
      forecastText += `${lowC}${WEATHER_UNIT_TEMP_C} / `;
      forecastText += `${lowF}${WEATHER_UNIT_TEMP_F}\n\n`;
    }
    
    return forecastText || "No forecast data available.";
  }
};
