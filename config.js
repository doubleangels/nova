require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_BOT_TOKEN,
  googleApiKey: process.env.GOOGLE_API_KEY,
  searchEngineId: process.env.SEARCH_ENGINE_ID,
  imageSearchEngineId: process.env.IMAGE_SEARCH_ENGINE_ID,
  omdbApiKey: process.env.OMDB_API_KEY,
  pirateWeatherApiKey: process.env.PIRATEWEATHER_API_KEY,
  malClientId: process.env.MAL_CLIENT_ID,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  logLevel: process.env.LOG_LEVEL || 'debug'
};