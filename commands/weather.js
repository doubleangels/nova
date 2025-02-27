const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const dayjs = require('dayjs');
const config = require('../config');
const { getCoordinates } = require('../utils/locationUtils');

/**
 * Module for the /weather command.
 * Retrieves the current weather for a specified place using the PirateWeather API.
 * It first obtains the coordinates of the place using a helper function and then fetches the weather data.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Get the current weather for a place.')
    .addStringOption(option =>
      option
        .setName('place')
        .setDescription('Enter the place name.')
        .setRequired(true)
    ),
    
  /**
   * Executes the /weather command.
   * @param {Interaction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Defer the reply to allow time for processing and API calls.
      await interaction.deferReply();
      logger.debug("/weather command received:", { user: interaction.user.tag });

      // Retrieve the 'place' option provided by the user.
      const place = interaction.options.getString('place');
      logger.debug("User input for place:", { place });
      
      // Get the latitude and longitude for the provided place using a helper function.
      const [lat, lon] = await getCoordinates(place);
      if (lat === null || lon === null) {
        logger.warn("Failed to get coordinates:", { place });
        await interaction.editReply(`❌ Could not find the location for '${place}'. Try another city.`);
        return;
      }
      
      // Format the place name for display (capitalize each word).
      const formattedPlace = place.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      logger.debug("Formatted place:", { formattedPlace, lat, lon });
      
      // Build the PirateWeather API URL using the coordinates.
      const url = `https://api.pirateweather.net/forecast/${config.pirateWeatherApiKey}/${lat},${lon}`;
      // Set additional parameters; here, we're using SI units.
      const params = new URLSearchParams({ units: "si" });
      const requestUrl = `${url}?${params.toString()}`;
      logger.debug("Making PirateWeather API request:", { requestUrl });
      
      // Fetch weather data from PirateWeather using axios.
      const response = await axios.get(requestUrl);
      if (response.status === 200) {
        const data = response.data;
        logger.debug("Received weather data:", { data });
        
        // Extract current weather details from the response.
        const currently = data.currently;
        // Get daily forecast data.
        const daily = data.daily.data;
        const weatherSummary = currently.summary || "Unknown";
        const tempC = currently.temperature || 0;
        const tempF = Math.round((tempC * 9/5) + 32);
        const feelsLikeC = currently.apparentTemperature || 0;
        const feelsLikeF = Math.round((feelsLikeC * 9/5) + 32);
        const humidity = (currently.humidity || 0) * 100;
        const windSpeed = currently.windSpeed || 0;
        const uvIndex = currently.uvIndex || "N/A";
        const visibility = currently.visibility || "N/A";
        const pressure = currently.pressure || "N/A";
        const dewPointC = currently.dewPoint !== undefined ? currently.dewPoint : "N/A";
        const dewPointF = typeof dewPointC === 'number' ? Math.round((dewPointC * 9/5) + 32) : "N/A";
        const cloudCover = (currently.cloudCover || 0) * 100;
        const precipIntensity = currently.precipIntensity || 0;
        const precipProbability = (currently.precipProbability || 0) * 100;
        
        // Build a forecast text for the next 3 days (or available days if less than 3).
        let forecastText = "";
        for (let i = 0; i < 3 && i < daily.length; i++) {
          const day = daily[i];
          const forecastDate = dayjs.unix(day.time).format('MM/DD/YYYY');
          const daySummary = day.summary || "No data";
          const highC = (typeof day.temperatureHigh === "number") ? day.temperatureHigh : "N/A";
          const highF = (typeof highC === "number") ? Math.round((highC * 9/5) + 32) : "N/A";
          const lowC = (typeof day.temperatureLow === "number") ? day.temperatureLow : "N/A";
          const lowF = (typeof lowC === "number") ? Math.round((lowC * 9/5) + 32) : "N/A";
          forecastText += `**${forecastDate}**\n**${daySummary}**\n🌡 High: ${highC}°C / ${highF}°F, Low: ${lowC}°C / ${lowF}°F\n\n`;
        }
        
        logger.debug("Extracted weather details:", {
          formattedPlace,
          temperature: `${tempC}°C / ${tempF}°F`,
          feelsLike: `${feelsLikeC}°C / ${feelsLikeF}°F`,
          humidity: `${humidity}%`
        });
        
        // Create an embed to display the weather data.
        const embed = new EmbedBuilder()
          .setTitle(`Weather in ${formattedPlace}`)
          .setDescription(`**${weatherSummary}**`)
          .setColor(0xFF6E42)
          .addFields(
            { name: "🌍 Location", value: `📍 ${formattedPlace}\n📍 Lat: ${lat}, Lon: ${lon}`, inline: false },
            { name: "🌡 Temperature", value: `${tempC}°C / ${tempF}°F`, inline: true },
            { name: "🤔 Feels Like", value: `${feelsLikeC}°C / ${feelsLikeF}°F`, inline: true },
            { name: "💧 Humidity", value: `${humidity}%`, inline: true },
            { name: "💨 Wind Speed", value: `${windSpeed} m/s`, inline: true },
            { name: "🌞 UV Index", value: `${uvIndex}`, inline: true },
            { name: "👀 Visibility", value: `${visibility} km`, inline: true },
            { name: "🛰 Pressure", value: `${pressure} hPa`, inline: true },
            { name: "🌫 Dew Point", value: `${dewPointC}°C / ${dewPointF}°F`, inline: true },
            { name: "☁ Cloud Cover", value: `${cloudCover}%`, inline: true },
            { name: "🌧 Precipitation", value: `${precipIntensity} mm/hr`, inline: true },
            { name: "🌧 Precip. Probability", value: `${precipProbability}%`, inline: true },
            { name: "📅 3-Day Forecast", value: forecastText, inline: false }
          )
          .setFooter({ text: "Powered by PirateWeather" });
        
        // Send the embed as the reply.
        await interaction.editReply({ embeds: [embed] });
        logger.debug("Weather embed sent successfully:", { formattedPlace });
      } else {
        // If the API response is not OK, log a warning and inform the user.
        logger.warn("PirateWeather API error:", { status: response.status });
        await interaction.editReply(`Error: PirateWeather API returned status code ${response.status}.`);
      }
    } catch (error) {
      // Log any unexpected errors and send an error message to the user.
      logger.error("Error in /weather command:", { error });
      await interaction.editReply({ content: "An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
