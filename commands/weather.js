const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const fetch = require('node-fetch').default;
const config = require('../config');
const { getCoordinates } = require('../utils/locationUtils');

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
  async execute(interaction) {
    try {
      await interaction.deferReply();
      logger.debug(`/weather command received from ${interaction.user.tag}`);
      
      const place = interaction.options.getString('place');
      logger.debug(`User input for place: '${place}'`);

      const [lat, lon] = await getCoordinates(place);
      if (lat === null || lon === null) {
        logger.warn(`Failed to get coordinates for '${place}'`);
        await interaction.editReply(`Could not find the location for '${place}'. Try another city.`);
        return;
      }
      
      const formattedPlace = place.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      logger.debug(`Formatted place: '${formattedPlace}' (Lat: ${lat}, Lon: ${lon})`);
      
      const url = `https://api.pirateweather.net/forecast/${config.pirateWeatherApiKey}/${lat},${lon}`;
      const params = new URLSearchParams({ units: "si" });
      logger.debug(`Making PirateWeather API request to: ${url}?${params.toString()}`);

      const response = await fetch(`${url}?${params.toString()}`);
      if (response.status === 200) {
        const data = await response.json();
        logger.debug(`Received weather data: ${JSON.stringify(data, null, 2)}`);

        const currently = data.currently;
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
        
        let forecastText = "";
        for (let i = 0; i < 3 && i < daily.length; i++) {
          const day = daily[i];
          const daySummary = day.summary || "No data";
          const highC = (typeof day.temperatureHigh === "number") ? day.temperatureHigh : "N/A";
          const highF = (typeof highC === "number") ? Math.round((highC * 9/5) + 32) : "N/A";
          const lowC = (typeof day.temperatureLow === "number") ? day.temperatureLow : "N/A";
          const lowF = (typeof lowC === "number") ? Math.round((lowC * 9/5) + 32) : "N/A";
          forecastText += `**Day ${i+1}:** ${daySummary}\n🌡 High: ${highC}°C / ${highF}°F, Low: ${lowC}°C / ${lowF}°F\n\n`;
        }
        
        logger.debug(`Extracted weather data for ${formattedPlace}: Temp ${tempC}°C, Feels Like ${feelsLikeC}°C, Humidity ${humidity}%`);
        
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
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        logger.warn(`PirateWeather API error: ${response.status}`);
        await interaction.editReply(`Error: PirateWeather API returned status code ${response.status}.`);
      }
    } catch (error) {
      logger.error(`Error in /weather command: ${error}`);
      await interaction.editReply({ content: "An unexpected error occurred. Please try again later.", ephemeral: true });
    }
  }
};
