require('dotenv').config();

/**
 * @typedef {Object} BotSettings
 * @property {boolean} deployCommandsOnStart - Whether to deploy slash commands on bot startup
 * @property {boolean} rescheduleReminderOnStart - Whether to reschedule reminders on bot startup
 * @property {boolean} rescheduleAllMuteKicksOnStart - Whether to reschedule mute kicks on bot startup
 * @property {string[]} disabledCommands - Array of command names that are disabled (derived from DISABLED_COMMANDS env var)
 *
 * To disable commands, set `DISABLED_COMMANDS` as a comma-separated list:
 * - `DISABLED_COMMANDS="promote,invite"`
 *
 * Disabled commands will not be deployed/updated to Discord on bot startup.
 */

function parseDisabledCommands(value) {
  if (value == null) return [];

  const trimmed = String(value).trim();
  if (trimmed === '') return [];

  // Comma-separated only (whitespace around commas is ok).
  return [...new Set(trimmed.split(',').map(s => s.trim()).filter(Boolean))];
}

function isSet(value) {
  return value != null && String(value).trim() !== '';
}

function isTruthyEnv(value) {
  if (!isSet(value)) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * First non-empty env var from `keys` (shared settings for /worldcup and /football).
 * @param {...string} keys
 * @returns {string|undefined}
 */
function envFirst(...keys) {
  for (const key of keys) {
    if (isSet(process.env[key])) return String(process.env[key]).trim();
  }
  return undefined;
}

/**
 * @param {string[]} keys
 * @param {number} defaultValue
 * @returns {number}
 */
function parsePositiveIntEnv(keys, defaultValue) {
  const raw = envFirst(...keys);
  if (raw == null) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

/** Shared by /worldcup and /football (legacy per-game env vars still accepted). */
const predictionParticipantRoleId = envFirst(
  'FOOTBALL_PREDICTION_PARTICIPANT_ROLE_ID',
  'WORLD_CUP_PARTICIPANT_ROLE_ID',
  'FOOTBALL_PARTICIPANT_ROLE_ID'
);
const predictionChannelId = envFirst(
  'FOOTBALL_PREDICTION_CHANNEL_ID',
  'WORLD_CUP_CHANNEL_ID',
  'FOOTBALL_CHANNEL_ID'
);
const predictionReminderHours = parsePositiveIntEnv(
  [
    'FOOTBALL_PREDICTION_REMINDER_HOURS',
    'WORLD_CUP_REMINDER_HOURS',
    'FOOTBALL_REMINDER_HOURS'
  ],
  24
);
const predictionPollIntervalMs = parsePositiveIntEnv(
  [
    'FOOTBALL_PREDICTION_POLL_INTERVAL_MS',
    'WORLD_CUP_POLL_INTERVAL_MS',
    'FOOTBALL_POLL_INTERVAL_MS'
  ],
  15 * 60 * 1000
);
const predictionMockApi = isTruthyEnv(
  envFirst('FOOTBALL_PREDICTION_MOCK_API', 'WORLD_CUP_MOCK_API', 'FOOTBALL_MOCK_API')
);
const predictionPendingTtlMs = parsePositiveIntEnv(
  ['FOOTBALL_PREDICTION_PENDING_TTL_MS'],
  15 * 60 * 1000
);
const predictionAiEnabled = isTruthyEnv(
  envFirst('FOOTBALL_PREDICTION_AI_ENABLED', 'PREDICTION_AI_ENABLED')
);
const geminiApiKey = envFirst('GEMINI_API_KEY');
const geminiPredictionModel =
  envFirst('FOOTBALL_PREDICTION_GEMINI_MODEL', 'GEMINI_PREDICTION_MODEL') ||
  'gemini-3.1-flash-lite';
const geminiPredictionCacheTtlMs = (() => {
  const raw = envFirst('FOOTBALL_PREDICTION_AI_CACHE_TTL_MS');
  if (raw == null) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
})();
const geminiContextCacheTtlSeconds = parsePositiveIntEnv(
  ['FOOTBALL_PREDICTION_AI_CONTEXT_CACHE_TTL_SECONDS', 'GEMINI_CONTEXT_CACHE_TTL_SECONDS'],
  3600
);
const geminiContextModel =
  envFirst('GEMINI_CONTEXT_MODEL', 'COMMAND_CONTEXT_GEMINI_MODEL') || undefined;
const geminiCommandContextCacheTtlMs = parsePositiveIntEnv(
  ['GEMINI_COMMAND_CONTEXT_CACHE_TTL_MS', 'COMMAND_CONTEXT_AI_CACHE_TTL_MS'],
  60 * 60 * 1000
);
const weatherAiEnabled = isTruthyEnv(envFirst('WEATHER_AI_ENABLED'));
const animeAiEnabled = isTruthyEnv(envFirst('ANIME_AI_ENABLED'));
const imdbAiEnabled = isTruthyEnv(envFirst('IMDB_AI_ENABLED'));
const bookAiEnabled = isTruthyEnv(envFirst('BOOK_AI_ENABLED'));
const googleAiEnabled = isTruthyEnv(envFirst('GOOGLE_AI_ENABLED', 'GOOGLE_SEARCH_AI_ENABLED'));
const googleImagesAiEnabled = isTruthyEnv(envFirst('GOOGLE_IMAGES_AI_ENABLED'));

/**
 * @typedef {Object} BotConfig
 * @property {BotSettings} settings - Bot behavior settings
 * @property {number} baseEmbedColor - Base embed color (hex number, from BASE_EMBED_COLOR env var)
 * @property {string} botStatus - Bot activity status text (from BOT_STATUS env var)
 * @property {string} botStatusType - Bot activity type (from BOT_STATUS_TYPE env var)
 * @property {string} clientId - Discord application client ID
 * @property {string} token - Discord bot token (from DISCORD_BOT_TOKEN env var)
 * @property {string} memberFrenRoleId - Role ID for Fren role (from MEMBER_FREN_ROLE_ID env var)
 * @property {string} customRolePositioningAnchorId - Role ID for positioning custom roles (from CUSTOM_ROLE_POSITIONING_ANCHOR_ID env var)
 * @property {string} googleApiKey - Google API key for search functionality (from GOOGLE_API_KEY env var)
 * @property {string} deeplApiKey - DeepL API key for translation functionality (from DEEPL_API_KEY env var)
 * @property {string} guildName - Guild name (from GUILD_NAME env var, default: 'Da Frens')
 * @property {string} imageSearchEngineId - Google Custom Search Engine ID for images (from IMAGE_SEARCH_ENGINE_ID env var)
 * @property {string} logLevel - Logging level (from LOG_LEVEL env var, default: 'info')
 * @property {string} malClientId - MyAnimeList API client ID (from MAL_CLIENT_ID env var)
 * @property {string} returningMemberRoleId - Role ID for members who've been in server before (from RETURNING_MEMBER_ROLE_ID env var)
 * @property {string} permissionBenchmarkRoleId - Role ID to compare permissions against (from PERMISSION_BENCHMARK_ROLE_ID env var)
 * @property {string} newMemberRoleId - Role ID for New Member role assigned to users with <100 messages (from NEW_MEMBER_ROLE_ID env var)
 * @property {string} omdbApiKey - OMDB API key for movie information (from OMDB_API_KEY env var)
 * @property {string} pirateWeatherApiKey - Pirate Weather API key for weather information (from PIRATEWEATHER_API_KEY env var)
 * @property {string} redditClientId - Reddit API client ID (from REDDIT_CLIENT_ID env var)
 * @property {string} redditClientSecret - Reddit API client secret (from REDDIT_CLIENT_SECRET env var)
 * @property {string} redditPassword - Reddit password for API authentication (from REDDIT_PASSWORD env var)
 * @property {string} redditUsername - Reddit username for API authentication (from REDDIT_USERNAME env var)
 * @property {string} searchEngineId - Google Custom Search Engine ID for web searches (from SEARCH_ENGINE_ID env var)
 * @property {string} serverInviteUrl - Server invite URL for kick messages (from SERVER_INVITE_URL env var)
 * @property {string} footballDataApiKey - football-data.org API token (from FOOTBALL_DATA_API_KEY env var)
 * @property {string|undefined} predictionParticipantRoleId - Shared participant role (/worldcup and /football register)
 * @property {string|undefined} predictionChannelId - Shared channel for prompts and match announcements
 * @property {number} predictionReminderHours - Hours before kickoff to post prediction prompts (both games)
 * @property {number} predictionPollIntervalMs - Fixture polling interval (both games)
 * @property {boolean} predictionMockApi - Simulated fixtures for /worldcup and /football (FOOTBALL_PREDICTION_MOCK_API)
 * @property {number} predictionPendingTtlMs - Ephemeral pick form TTL in ms (FOOTBALL_PREDICTION_PENDING_TTL_MS)
 * @property {boolean} predictionAiEnabled - Gemini match suggestions on prompts (FOOTBALL_PREDICTION_AI_ENABLED)
 * @property {string|undefined} geminiApiKey - Google AI Studio key for Gemini (GEMINI_API_KEY)
 * @property {string} geminiPredictionModel - Gemini model id for match predictions (default gemini-3.1-flash-lite)
 * @property {number} geminiPredictionCacheTtlMs - AI result cache TTL (0 = until kickoff)
 * @property {number} geminiContextCacheTtlSeconds - Gemini explicit system-instruction cache TTL
 * @property {string|undefined} geminiContextModel - Gemini model for command context fields (default: prediction model)
 * @property {number} geminiCommandContextCacheTtlMs - Command AI context result cache TTL
 * @property {boolean} weatherAiEnabled - Gemini outlook on /weather (WEATHER_AI_ENABLED)
 * @property {boolean} animeAiEnabled - Gemini status on /anime (ANIME_AI_ENABLED)
 * @property {boolean} imdbAiEnabled - Gemini context on /imdb (IMDB_AI_ENABLED)
 * @property {boolean} bookAiEnabled - Gemini reader note on /book (BOOK_AI_ENABLED)
 * @property {boolean} googleAiEnabled - Gemini insight on /google (GOOGLE_AI_ENABLED)
 * @property {boolean} googleImagesAiEnabled - Gemini insight on /googleimages (GOOGLE_IMAGES_AI_ENABLED)
 * @property {string} worldCupCompetitionCode - football-data.org competition code (from WORLD_CUP_COMPETITION_CODE env var)
 * @property {string} worldCupSeason - Season year for competition matches (from WORLD_CUP_SEASON env var)
 * @property {string[]} footballCompetitionCodes - football-data.org codes (PL, BL1, PD, CL)
 * @property {string} footballSeason - Club season start year (FOOTBALL_SEASON or Aug–Jul default)
 * // Spotify integration removed
 */

/** @type {BotConfig} */
module.exports = {
  settings: {
    deployCommandsOnStart: true,
    rescheduleReminderOnStart: true,
    rescheduleAllMuteKicksOnStart: true,
    disabledCommands: parseDisabledCommands(process.env.DISABLED_COMMANDS),
  },
  // Base embed color in hex format (e.g., CD41FF or #CD41FF); default #999999
  baseEmbedColor: (() => {
    const colorStr = (process.env.BASE_EMBED_COLOR || '#999999').trim();
    // Remove # or 0x prefix if present
    const cleanColor = colorStr.replace(/^#/, '').replace(/^0x/i, '');
    const parsed = parseInt(cleanColor, 16);
    return isNaN(parsed) ? 0x999999 : parsed;
  })(),
  // Bot activity status text
  botStatus: process.env.BOT_STATUS,
  // Bot activity type (playing, watching, listening, streaming, competing)
  botStatusType: process.env.BOT_STATUS_TYPE || 'watching',
  clientId: process.env.DISCORD_CLIENT_ID || '1280311987154456657',
  // Authentication token for your Discord bot
  token: process.env.DISCORD_BOT_TOKEN,
  // Discord role ID to assign alongside custom roles
  memberFrenRoleId: process.env.MEMBER_FREN_ROLE_ID,
  // Discord role ID that custom roles should be positioned above
  customRolePositioningAnchorId: process.env.CUSTOM_ROLE_POSITIONING_ANCHOR_ID,
  // API key for Google services
  googleApiKey: process.env.GOOGLE_API_KEY,
  // API key for DeepL translation service
  deeplApiKey: process.env.DEEPL_API_KEY,
  // Name of the guild/server
  guildName: process.env.GUILD_NAME || 'Da Frens',
  // Google Custom Search Engine ID for image searches
  imageSearchEngineId: process.env.IMAGE_SEARCH_ENGINE_ID,
  // Determines the verbosity of logs (error, warn, info, debug)
  logLevel: process.env.LOG_LEVEL || 'info',
  // Client ID for MyAnimeList API
  malClientId: process.env.MAL_CLIENT_ID,
  // Role ID for members who've been in server before (returning members)
  returningMemberRoleId: process.env.RETURNING_MEMBER_ROLE_ID,
  // Role ID to use as permission comparison benchmark
  permissionBenchmarkRoleId: process.env.PERMISSION_BENCHMARK_ROLE_ID,
  // Role ID for Noobies role assigned to users with <100 messages
  newMemberRoleId: process.env.NEW_MEMBER_ROLE_ID,
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
  // football-data.org (World Cup predictions)
  footballDataApiKey: process.env.FOOTBALL_DATA_API_KEY,
  predictionParticipantRoleId,
  predictionChannelId,
  predictionReminderHours,
  predictionPollIntervalMs,
  predictionMockApi,
  predictionPendingTtlMs,
  predictionAiEnabled,
  geminiApiKey,
  geminiPredictionModel,
  geminiPredictionCacheTtlMs,
  geminiContextCacheTtlSeconds,
  geminiContextModel,
  geminiCommandContextCacheTtlMs,
  weatherAiEnabled,
  animeAiEnabled,
  imdbAiEnabled,
  bookAiEnabled,
  googleAiEnabled,
  googleImagesAiEnabled,
  worldCupCompetitionCode: process.env.WORLD_CUP_COMPETITION_CODE || 'WC',
  worldCupSeason: process.env.WORLD_CUP_SEASON || '2026',
  // Club football predictions (Premier League, Bundesliga, La Liga, Champions League)
  footballCompetitionCodes: (() => {
    const { parseCompetitionCodes } = require('./utils/footballCompetitions');
    return parseCompetitionCodes(process.env.FOOTBALL_COMPETITION_CODES);
  })(),
  footballSeason: (() => {
    const { getDefaultFootballSeasonYear } = require('./utils/footballSeason');
    const fromEnv = process.env.FOOTBALL_SEASON?.trim();
    return fromEnv || String(getDefaultFootballSeasonYear());
  })(),
  // Spotify integration removed
};

// Optional (not required to start): SENTRY_DSN — error monitoring (@sentry/node, see instrument.js).
// Sentry environment uses NODE_ENV (default production). Release is set from package.json name + version in instrument.js.

// Required env vars (no default); bot fails to start if any are missing
const REQUIRED_ENV_VARS = [
  'DISCORD_BOT_TOKEN',
  'BOT_STATUS',
  'MEMBER_FREN_ROLE_ID',
  'CUSTOM_ROLE_POSITIONING_ANCHOR_ID',
  'GOOGLE_API_KEY',
  'IMAGE_SEARCH_ENGINE_ID',
  'MAL_CLIENT_ID',
  'RETURNING_MEMBER_ROLE_ID',
  'PERMISSION_BENCHMARK_ROLE_ID',
  'NEW_MEMBER_ROLE_ID',
  'OMDB_API_KEY',
  'PIRATEWEATHER_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_PASSWORD',
  'REDDIT_USERNAME',
  'SEARCH_ENGINE_ID',
  'SERVER_INVITE_URL',
  // Spotify env vars removed
];

const missing = REQUIRED_ENV_VARS.filter(name => !isSet(process.env[name]));
if (missing.length > 0) {
  console.error('Missing required environment variable(s). Bot cannot start.');
  console.error('Set the following variables in your .env or environment.');
  missing.forEach(name => console.error(`  - ${name}`));
  process.exit(1);
}

if (!isSet(process.env.DEEPL_API_KEY)) {
  console.warn('DEEPL_API_KEY is not set. Flag-emoji translation reactions will be unavailable.');
}

if (predictionMockApi) {
  console.warn(
    'FOOTBALL_PREDICTION_MOCK_API is enabled. /worldcup and /football use simulated fixtures instead of football-data.org.'
  );
} else if (!isSet(process.env.FOOTBALL_DATA_API_KEY)) {
  console.warn(
    'FOOTBALL_DATA_API_KEY is not set. /worldcup and /football predictions will be unavailable.'
  );
}

const predictionApiActive =
  predictionMockApi || isSet(process.env.FOOTBALL_DATA_API_KEY);

if (predictionApiActive && !predictionChannelId) {
  console.warn(
    'FOOTBALL_PREDICTION_CHANNEL_ID is not set. Prediction prompts and announcements will not be posted.'
  );
}

if (predictionApiActive && !predictionParticipantRoleId) {
  console.warn(
    'FOOTBALL_PREDICTION_PARTICIPANT_ROLE_ID is not set. /football register cannot assign a participant role.'
  );
}

if (predictionAiEnabled && !geminiApiKey) {
  console.warn(
    'FOOTBALL_PREDICTION_AI_ENABLED is set but GEMINI_API_KEY is missing. AI match suggestions will be skipped.'
  );
}

const commandAiFlags = [
  ['WEATHER_AI_ENABLED', weatherAiEnabled],
  ['ANIME_AI_ENABLED', animeAiEnabled],
  ['IMDB_AI_ENABLED', imdbAiEnabled],
  ['BOOK_AI_ENABLED', bookAiEnabled],
  ['GOOGLE_AI_ENABLED', googleAiEnabled],
  ['GOOGLE_IMAGES_AI_ENABLED', googleImagesAiEnabled]
];

for (const [envName, enabled] of commandAiFlags) {
  if (enabled && !geminiApiKey) {
    console.warn(
      `${envName} is set but GEMINI_API_KEY is missing. That command's AI insight field will be skipped.`
    );
  }
}

