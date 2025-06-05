/**
 * Configuration module for the Discord bot.
 * Loads environment variables and exports configuration settings.
 * @module config
 */

require('dotenv').config();

/**
 * Main configuration object containing all bot settings and API keys.
 * @type {Object}
 */
module.exports = {
  /** Bot behavior settings */
  settings: {
    /** Whether to deploy slash commands when the bot starts */
    deployCommandsOnStart: true,
    /** Whether to reschedule reminders when the bot starts */
    rescheduleReminderOnStart: true,
    /** Whether to reschedule mute kicks when the bot starts */
    rescheduleAllMuteKicksOnStart: true,
    /** List of command names to disable */
    disabledCommands: [],
  },
  /** Discord bot token from environment variables */
  token: process.env.DISCORD_BOT_TOKEN,
  /** Discord application client ID */
  clientId: "1280311987154456657",
  /** Neon database connection string */
  neonConnectionString: process.env.NEON_CONNECTION_STRING,
  /** Google API key for various services */
  googleApiKey: process.env.GOOGLE_API_KEY,
  /** Google Custom Search Engine ID */
  searchEngineId: process.env.SEARCH_ENGINE_ID,
  /** Google Custom Image Search Engine ID */
  imageSearchEngineId: process.env.IMAGE_SEARCH_ENGINE_ID,
  /** OMDB API key for movie information */
  omdbApiKey: process.env.OMDB_API_KEY,
  /** Pirate Weather API key for weather information */
  pirateWeatherApiKey: process.env.PIRATEWEATHER_API_KEY,
  /** MyAnimeList API client ID */
  malClientId: process.env.MAL_CLIENT_ID,
  /** Spotify API client ID */
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  /** Spotify API client secret */
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  /** Logging level (defaults to 'info' if not set) */
  logLevel: process.env.LOG_LEVEL || 'info',
  /** Role ID for permission management - position above */
  givePermsPositionAboveRoleId: process.env.GIVE_PERMS_POSITION_ABOVE_ROLE_ID,
  /** Role ID for permission management - fren role */
  givePermsFrenRoleId: process.env.GIVE_PERMS_FREN_ROLE_ID,
};
