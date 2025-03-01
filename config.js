require('dotenv').config();

/**
 * Configuration file for the bot.
 *
 * Exports environment variables used throughout the bot's code.
 */
module.exports = {
  // Discord bot token
  token: process.env.DISCORD_BOT_TOKEN,
  // Google API key for geocoding, timezone, and search functionalities
  googleApiKey: process.env.GOOGLE_API_KEY,
  // Search engine ID for Google Custom Search
  searchEngineId: process.env.SEARCH_ENGINE_ID,
  // Search engine ID specifically for image search on Google
  imageSearchEngineId: process.env.IMAGE_SEARCH_ENGINE_ID,
  // OMDb API key for retrieving movie data
  omdbApiKey: process.env.OMDB_API_KEY,
  // PirateWeather API key for weather data
  pirateWeatherApiKey: process.env.PIRATEWEATHER_API_KEY,
  // MyAnimeList client ID for anime searches
  malClientId: process.env.MAL_CLIENT_ID,
  // Supabase URL for database operations
  supabaseUrl: process.env.SUPABASE_URL,
  // Supabase key for database operations
  supabaseKey: process.env.SUPABASE_KEY,
  // Logging level; defaults to 'debug' if not set
  logLevel: process.env.LOG_LEVEL || 'info'
};
