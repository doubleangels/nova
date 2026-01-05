require('dotenv').config();

/**
 * @typedef {Object} BotSettings
 * @property {boolean} deployCommandsOnStart - Whether to deploy slash commands on bot startup
 * @property {boolean} rescheduleReminderOnStart - Whether to reschedule reminders on bot startup
 * @property {boolean} rescheduleAllMuteKicksOnStart - Whether to reschedule mute kicks on bot startup
 * @property {string[]} disabledCommands - Array of command names that are disabled
 * 
 * @example
 * // To disable commands, add their names to the disabledCommands array:
 * // disabledCommands: ['promote', 'invite']
 * // Disabled commands will not be deployed/updated to Discord on bot startup
 */

/**
 * @typedef {Object} BotConfig
 * @property {BotSettings} settings - Bot behavior settings
 * @property {number} baseEmbedColor - Base embed color (hex number, from BASE_EMBED_COLOR env var)
 * @property {string} botStatus - Bot activity status text (from BOT_STATUS env var)
 * @property {string} botStatusType - Bot activity type (from BOT_STATUS_TYPE env var)
 * @property {string} clientId - Discord application client ID
 * @property {string} token - Discord bot token (from DISCORD_BOT_TOKEN env var)
 * @property {string} exchangeRateApiKey - exchangerate.host API key for currency conversion (from EXCHANGERATE_API_KEY env var)
 * @property {string} givePermsFrenRoleId - Role ID for Fren role (from GIVE_PERMS_FREN_ROLE_ID env var)
 * @property {string} givePermsPositionAboveRoleId - Role ID for permission management (from GIVE_PERMS_POSITION_ABOVE_ROLE_ID env var)
 * @property {string} googleApiKey - Google API key for search functionality (from GOOGLE_API_KEY env var)
 * @property {string} guildName - Guild name (from GUILD_NAME env var, default: 'Da Frens')
 * @property {string} imageSearchEngineId - Google Custom Search Engine ID for images (from IMAGE_SEARCH_ENGINE_ID env var)
 * @property {string} logLevel - Logging level (from LOG_LEVEL env var, default: 'info')
 * @property {string} malClientId - MyAnimeList API client ID (from MAL_CLIENT_ID env var)
 * @property {string} omdbApiKey - OMDB API key for movie information (from OMDB_API_KEY env var)
 * @property {string} pirateWeatherApiKey - Pirate Weather API key for weather information (from PIRATEWEATHER_API_KEY env var)
 * @property {string} redditClientId - Reddit API client ID (from REDDIT_CLIENT_ID env var)
 * @property {string} redditClientSecret - Reddit API client secret (from REDDIT_CLIENT_SECRET env var)
 * @property {string} redditPassword - Reddit password for API authentication (from REDDIT_PASSWORD env var)
 * @property {string} redditUsername - Reddit username for API authentication (from REDDIT_USERNAME env var)
 * @property {string} searchEngineId - Google Custom Search Engine ID for web searches (from SEARCH_ENGINE_ID env var)
 * @property {string} serverInviteUrl - Server invite URL for kick messages (from SERVER_INVITE_URL env var)
 * @property {string} spotifyClientId - Spotify API client ID (from SPOTIFY_CLIENT_ID env var)
 * @property {string} spotifyClientSecret - Spotify API client secret (from SPOTIFY_CLIENT_SECRET env var)
 */

/** @type {BotConfig} */
module.exports = {
  settings: {
    deployCommandsOnStart: true,
    rescheduleReminderOnStart: true,
    rescheduleAllMuteKicksOnStart: true,
    disabledCommands: [],
  },
  // Base embed color in hex format (e.g., CD41FF or #CD41FF)
  baseEmbedColor: (() => {
    if (!process.env.BASE_EMBED_COLOR) {
      return null;
    }
    const colorStr = process.env.BASE_EMBED_COLOR.trim();
    // Remove # or 0x prefix if present
    const cleanColor = colorStr.replace(/^#/, '').replace(/^0x/i, '');
    const parsed = parseInt(cleanColor, 16);
    return isNaN(parsed) ? null : parsed;
  })(),
  // Bot activity status text
  botStatus: process.env.BOT_STATUS,
  // Bot activity type (playing, watching, listening, streaming, competing)
  botStatusType: process.env.BOT_STATUS_TYPE || 'watching',
  clientId: "1280311987154456657",
  // Authentication token for your Discord bot
  token: process.env.DISCORD_BOT_TOKEN,
  // exchangerate.host API key for currency conversion
  exchangeRateApiKey: process.env.EXCHANGERATE_API_KEY,
  // Discord role ID to assign alongside custom roles
  givePermsFrenRoleId: process.env.GIVE_PERMS_FREN_ROLE_ID,
  // Discord role ID that new roles should be positioned above
  givePermsPositionAboveRoleId: process.env.GIVE_PERMS_POSITION_ABOVE_ROLE_ID,
  // API key for Google services
  googleApiKey: process.env.GOOGLE_API_KEY,
  // Name of the guild/server
  guildName: process.env.GUILD_NAME || 'Da Frens',
  // Google Custom Search Engine ID for image searches
  imageSearchEngineId: process.env.IMAGE_SEARCH_ENGINE_ID,
  // Determines the verbosity of logs (error, warn, info, debug)
  logLevel: process.env.LOG_LEVEL || 'info',
  // Client ID for MyAnimeList API
  malClientId: process.env.MAL_CLIENT_ID,
  // API key for Open Movie Database
  omdbApiKey: process.env.OMDB_API_KEY,
  // API key for PirateWeather forecast service
  pirateWeatherApiKey: process.env.PIRATEWEATHER_API_KEY,
  // Client ID for Reddit API
  redditClientId: process.env.REDDIT_CLIENT_ID,
  // Client Secret for Reddit API
  redditClientSecret: process.env.REDDIT_CLIENT_SECRET,
  // Reddit password for API authentication
  redditPassword: process.env.REDDIT_PASSWORD,
  // Reddit username for API authentication
  redditUsername: process.env.REDDIT_USERNAME,
  // Google Custom Search Engine ID for web searches
  searchEngineId: process.env.SEARCH_ENGINE_ID,
  // Server invite URL for kick messages
  serverInviteUrl: process.env.SERVER_INVITE_URL,
  // Client ID for Spotify API
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  // Client Secret for Spotify API
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
};
