/**
 * Configuration module for the Discord bot.
 * Loads environment variables and exports configuration settings.
 * @module config
 */

require('dotenv').config();

module.exports = {
  settings: {
    deployCommandsOnStart: true,
    rescheduleReminderOnStart: true,
    rescheduleAllMuteKicksOnStart: true,
    disabledCommands: [],
  },
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: "1280311987154456657",
  neonConnectionString: process.env.NEON_CONNECTION_STRING,
  googleApiKey: process.env.GOOGLE_API_KEY,
  searchEngineId: process.env.SEARCH_ENGINE_ID,
  imageSearchEngineId: process.env.IMAGE_SEARCH_ENGINE_ID,
  omdbApiKey: process.env.OMDB_API_KEY,
  pirateWeatherApiKey: process.env.PIRATEWEATHER_API_KEY,
  malClientId: process.env.MAL_CLIENT_ID,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  logLevel: process.env.LOG_LEVEL || 'info',
  givePermsPositionAboveRoleId: process.env.GIVE_PERMS_POSITION_ABOVE_ROLE_ID,
  givePermsFrenRoleId: process.env.GIVE_PERMS_FREN_ROLE_ID,
};
