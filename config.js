require('dotenv').config();

/**
 * @typedef {Object} BotSettings
 * @property {boolean} deployCommandsOnStart - Whether to deploy slash commands on bot startup
 * @property {boolean} rescheduleReminderOnStart - Whether to reschedule reminders on bot startup
 * @property {boolean} rescheduleAllMuteKicksOnStart - Whether to reschedule mute kicks on bot startup
 * @property {string[]} disabledCommands - Array of command names that are disabled
 */

/**
 * @typedef {Object} BotConfig
 * @property {BotSettings} settings - Bot behavior settings
 * @property {string} token - Discord bot token
 * @property {string} clientId - Discord application client ID
 * @property {string} neonConnectionString - Neon database connection string
 * @property {string} googleApiKey - Google API key for search functionality
 * @property {string} searchEngineId - Google Custom Search Engine ID
 * @property {string} imageSearchEngineId - Google Custom Search Engine ID for images
 * @property {string} omdbApiKey - OMDB API key for movie information
 * @property {string} pirateWeatherApiKey - Pirate Weather API key for weather information
 * @property {string} nasaApiKey - NASA API key for APOD and other endpoints
 * @property {string} malClientId - MyAnimeList API client ID
 * @property {string} spotifyClientId - Spotify API client ID
 * @property {string} spotifyClientSecret - Spotify API client secret
 * @property {string} redditClientId - Reddit API client ID
 * @property {string} redditClientSecret - Reddit API client secret
 * @property {string} redditUsername - Reddit account username
 * @property {string} redditPassword - Reddit account password
 * @property {string} logLevel - Logging level (default: 'info')
 * @property {string} givePermsPositionAboveRoleId - Role ID for permission management
 * @property {string} givePermsFrenRoleId - Role ID for Fren role
 * @property {string} exchangeRateApiKey - exchangerate.host API key for currency conversion
 */

/** @type {BotConfig} */
module.exports = {
  settings: {
    deployCommandsOnStart: true,
    rescheduleReminderOnStart: true,
    rescheduleAllMuteKicksOnStart: true,
    disabledCommands: [],
  },
  clientId: "1280311987154456657",
  exchangeRateApiKey: process.env.EXCHANGERATE_API_KEY,
  givePermsFrenRoleId: process.env.GIVE_PERMS_FREN_ROLE_ID,
  givePermsPositionAboveRoleId: process.env.GIVE_PERMS_POSITION_ABOVE_ROLE_ID,
  googleApiKey: process.env.GOOGLE_API_KEY,
  imageSearchEngineId: process.env.IMAGE_SEARCH_ENGINE_ID,
  logLevel: process.env.LOG_LEVEL || 'info',
  malClientId: process.env.MAL_CLIENT_ID,
  neonConnectionString: process.env.NEON_CONNECTION_STRING,
  omdbApiKey: process.env.OMDB_API_KEY,
  nasaApiKey: process.env.NASA_API_KEY,
  pirateWeatherApiKey: process.env.PIRATEWEATHER_API_KEY,
  redditClientId: process.env.REDDIT_CLIENT_ID,
  redditClientSecret: process.env.REDDIT_CLIENT_SECRET,
  redditPassword: process.env.REDDIT_PASSWORD,
  redditUsername: process.env.REDDIT_USERNAME,
  searchEngineId: process.env.SEARCH_ENGINE_ID,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  token: process.env.DISCORD_BOT_TOKEN,
};
