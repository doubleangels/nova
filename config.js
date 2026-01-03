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
 * @property {string} clientId - Discord application client ID
 * @property {string} exchangeRateApiKey - exchangerate.host API key for currency conversion
 * @property {string} botStatus - Bot activity status text (from BOT_STATUS env var)
 * @property {string} botStatusType - Bot activity type (from BOT_STATUS_TYPE env var)
 * @property {string} givePermsFrenRoleId - Role ID for Fren role
 * @property {string} givePermsPositionAboveRoleId - Role ID for permission management
 * @property {string} googleApiKey - Google API key for search functionality
 * @property {string} guildName - Guild name (default: 'Da Frens')
 * @property {string} imageSearchEngineId - Google Custom Search Engine ID for images
 * @property {string} logLevel - Logging level (default: 'info')
 * @property {string} malClientId - MyAnimeList API client ID
 * @property {string} omdbApiKey - OMDB API key for movie information
 * @property {string} pirateWeatherApiKey - Pirate Weather API key for weather information
 * @property {string} redditClientId - Reddit API client ID
 * @property {string} redditClientSecret - Reddit API client secret
 * @property {string} redditPassword - Reddit password for API authentication
 * @property {string} redditUsername - Reddit username for API authentication
 * @property {string} searchEngineId - Google Custom Search Engine ID for web searches
 * @property {string} serverInviteUrl - Server invite URL for kick messages (from SERVER_INVITE_URL env var)
 * @property {string} spotifyClientId - Spotify API client ID
 * @property {string} spotifyClientSecret - Spotify API client secret
 * @property {string} token - Discord bot token
 */

/** @type {BotConfig} */
module.exports = {
  settings: {
    deployCommandsOnStart: true,
    rescheduleReminderOnStart: true,
    rescheduleAllMuteKicksOnStart: true,
    disabledCommands: [],
  },
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
  botStatus: process.env.BOT_STATUS,
  botStatusType: process.env.BOT_STATUS_TYPE || 'watching',
  clientId: "1280311987154456657",
  exchangeRateApiKey: process.env.EXCHANGERATE_API_KEY,
  givePermsFrenRoleId: process.env.GIVE_PERMS_FREN_ROLE_ID,
  givePermsPositionAboveRoleId: process.env.GIVE_PERMS_POSITION_ABOVE_ROLE_ID,
  googleApiKey: process.env.GOOGLE_API_KEY,
  guildName: process.env.GUILD_NAME || 'Da Frens',
  imageSearchEngineId: process.env.IMAGE_SEARCH_ENGINE_ID,
  logLevel: process.env.LOG_LEVEL || 'info',
  malClientId: process.env.MAL_CLIENT_ID,
  omdbApiKey: process.env.OMDB_API_KEY,
  pirateWeatherApiKey: process.env.PIRATEWEATHER_API_KEY,
  redditClientId: process.env.REDDIT_CLIENT_ID,
  redditClientSecret: process.env.REDDIT_CLIENT_SECRET,
  redditPassword: process.env.REDDIT_PASSWORD,
  redditUsername: process.env.REDDIT_USERNAME,
  searchEngineId: process.env.SEARCH_ENGINE_ID,
  serverInviteUrl: process.env.SERVER_INVITE_URL,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  token: process.env.DISCORD_BOT_TOKEN,
};
