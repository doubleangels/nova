/**
 * We provide centralized error handling and messages for the bot.
 * This module provides consistent error messages and handling across all commands.
 */

const path = require('path');
const logger = require('./logger')(path.basename(__filename));

/**
 * We define common error codes and their corresponding messages
 */
const ERROR_MESSAGES = {
    DISCORD_PERMISSIONS: "⚠️ I don't have the required permissions to execute this command.",
    DISCORD_MISSING_ACCESS: "⚠️ I don't have access to perform this action. Please check my permissions.",
    DISCORD_RATE_LIMIT: "⚠️ Discord is currently rate limiting this action. Please try again in a few moments.",
    DISCORD_MESSAGE_NOT_FOUND: "⚠️ The message could not be found. It may have been deleted.",
    DISCORD_ROLE_NOT_FOUND: "⚠️ The role could not be found. It may have been deleted.",
    DISCORD_MAX_ROLES: "⚠️ This server has reached the maximum number of roles allowed by Discord.",
    DISCORD_INVALID_CHANNEL: "⚠️ Please select a text channel for this operation.",
    DISCORD_MANAGED_ROLE: "⚠️ I cannot assign managed roles (bot or integration roles).",
    DISCORD_ROLE_HIERARCHY: "⚠️ I can't assign this role because it's higher than or equal to my highest role.",
    DISCORD_USER_HIERARCHY: "⚠️ You don't have permission to assign a role higher than your highest role.",
    DISCORD_USER_NOT_FOUND: "⚠️ The specified user could not be found in this server.",
    DISCORD_ALREADY_HAS_ROLE: "⚠️ User already has this role.",
    DM_NOT_SUPPORTED: "⚠️ This command cannot be used in direct messages.",

    API_ERROR: "⚠️ An error occurred while communicating with the external service.",
    API_RATE_LIMIT: "⚠️ API rate limit reached. Please try again in a few moments.",
    API_ACCESS_DENIED: "⚠️ API access denied. Please check API configuration.",
    API_INVALID_RESPONSE: "⚠️ Received invalid response from the API. Please try again later.",
    API_TIMEOUT: "⚠️ API request timed out. Please try again later.",
    API_NETWORK_ERROR: "⚠️ Network error: Could not connect to the service. Please check your internet connection.",
    API_NO_RESULTS: "⚠️ No results found. Try refining your search query.",
    REQUEST_TIMEOUT: "⚠️ The request timed out. Please try again later.",
    RATE_LIMIT_EXCEEDED: "⚠️ Rate limit exceeded. Please try again later.",
    NETWORK_ERROR: "⚠️ Network error occurred. Please check your internet connection.",

    DATABASE_READ_ERROR: "⚠️ Failed to retrieve data from the database. Please try again later.",
    DATABASE_WRITE_ERROR: "⚠️ Failed to save data to the database. Please try again later.",
    DATABASE_CONNECTION_ERROR: "⚠️ Database connection error. Please try again later.",
    DATABASE_ERROR: "⚠️ A database error occurred. Please try again later.",

    CONFIG_MISSING: "⚠️ This command is not properly configured. Please contact an administrator.",
    CONFIG_INVALID: "⚠️ Invalid configuration detected. Please contact an administrator.",
    CONFIG_INCOMPLETE: "⚠️ Configuration is incomplete. Please contact an administrator.",

    BACKUP_MODE_NO_SETTINGS: "⚠️ Please provide at least one setting to update (channel, role, or enabled status).",
    BACKUP_MODE_INVALID_CHANNEL: "⚠️ The channel must be a text channel for welcome messages.",
    BACKUP_MODE_INVALID_ROLE: "⚠️ I cannot assign the selected role. Please choose a role that is below my highest role.",

    CAT_API_ERROR: "⚠️ Couldn't fetch a cat picture due to an API error. Try again later.",
    CAT_NETWORK_ERROR: "⚠️ Couldn't connect to the cat image service. Please check your internet connection.",
    CAT_INVALID_IMAGE: "⚠️ The cat service didn't send a proper image. Please try again.",

    CHANGENICKNAME_INSUFFICIENT_PERMISSIONS: "⚠️ I don't have permission to manage nicknames in this server.",
    CHANGENICKNAME_TOO_LONG: "⚠️ Nickname must be 32 characters or less.",
    CHANGENICKNAME_OWNER: "⚠️ Cannot change the server owner's nickname.",
    CHANGENICKNAME_BOT: "⚠️ Cannot change the bot's nickname.",
    CHANGENICKNAME_ROLE_HIERARCHY: "⚠️ You cannot change the nickname of users with a higher or equal role.",

    DOG_API_ERROR: "⚠️ Couldn't fetch a dog picture due to an API error. Try again later.",
    DOG_NO_IMAGE: "⚠️ Couldn't find a dog picture. Try again later.",
    DOG_IMAGE_FETCH_ERROR: "⚠️ Couldn't download the dog picture. Try again later.",

    GOOGLE_INVALID_QUERY: "⚠️ Please provide a valid search query.",
    GOOGLE_NO_RESULTS: "⚠️ No search results found. Try refining your query!",

    IMDB_INVALID_TITLE: "⚠️ Please provide a valid movie or show title.",
    IMDB_INVALID_YEAR: "⚠️ Year must be in the format YYYY (e.g., 2021).",

    MOCK_NO_CONTENT: "⚠️ There is no text to mock!",
    MOCK_BOT_MESSAGE: "⚠️ I cannot mock my own messages!",

    MUTE_MODE_INVALID_TIME: "⚠️ Invalid time limit specified. Using default value.",

    REMINDER_INVALID_CHANNEL: "⚠️ Please select a text channel for reminders.",
    REMINDER_CONFIG_INCOMPLETE: "⚠️ Reminder configuration is incomplete.",

    SPOTIFY_INVALID_QUERY: "⚠️ Please provide a valid search query.",
    SPOTIFY_NO_RESULTS: "⚠️ No results found for your search.",

    TIMEZONE_INVALID_FORMAT: "⚠️ Invalid timezone format. Please use the format: UTC±HH:MM",
    TIMEZONE_INVALID_OFFSET: "⚠️ Invalid timezone offset. Please use a value between -12 and +14.",

    TROLLMODE_INVALID_AGE: "⚠️ Invalid age specified. Please provide a valid age.",

    URBAN_NO_DEFINITION: "⚠️ No definition found for this term.",
    URBAN_INVALID_QUERY: "⚠️ Please provide a valid search term.",

    WEATHER_INVALID_LOCATION: "⚠️ Could not find the specified location.",
    WEATHER_API_ERROR: "⚠️ Failed to fetch weather data. Please try again later.",

    WIKIPEDIA_NO_RESULTS: "⚠️ No Wikipedia articles found for your search.",
    WIKIPEDIA_INVALID_QUERY: "⚠️ Please provide a valid search query.",

    YOUTUBE_INVALID_QUERY: "⚠️ Please provide a valid search query.",
    YOUTUBE_NO_RESULTS: "⚠️ No results found for your search.",
    YOUTUBE_INVALID_DURATION: "⚠️ Invalid duration filter specified.",

    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred. Please try again later.",
    VALIDATION_ERROR: "⚠️ Invalid input provided. Please check your command parameters.",
    PERMISSION_ERROR: "⚠️ You don't have permission to use this command.",
    RATE_LIMIT_ERROR: "⚠️ You're being rate limited. Please try again later.",
    TIMEOUT_ERROR: "⚠️ The operation timed out. Please try again later.",
    INVALID_RESPONSE: "⚠️ Received an invalid response. Please try again later.",
    NO_RESULTS_FOUND: "⚠️ No results found. Please try a different search.",

    UNKNOWN_ERROR: 'An unexpected error occurred.',
    INVALID_INPUT: 'Invalid input provided.',

    DATABASE_INITIALIZATION_FAILED: 'Failed to initialize database.',
    DATABASE_QUERY_FAILED: 'Database query failed.',
    DATABASE_TRANSACTION_FAILED: 'Database transaction failed.',
    DATABASE_BACKUP_FAILED: 'Database backup failed.',

    COMMAND_DEPLOYMENT_FAILED: 'Failed to deploy commands.',
    INVALID_COMMAND: 'Invalid command provided.',
    COMMAND_EXECUTION_FAILED: 'Command execution failed.',

    INVALID_EVENT_FILE: 'Event file is missing required properties.',
    EVENT_HANDLING_FAILED: 'Failed to handle event.',

    INVALID_TIMEZONE: 'Invalid timezone provided.',
    EMPTY_TIME_REFERENCE: 'No time reference provided.',
    TIME_PARSE_FAILED: 'Failed to parse time reference.',
    TIME_CONVERSION_FAILED: 'Failed to convert time.',
    INVALID_TIMESTAMP_PARAMS: 'Invalid timestamp parameters.',
    INVALID_CONVERSION: 'Invalid conversion data.',
    NO_TIMES_TO_CONVERT: 'No times to convert.',

    LOCATION_LOOKUP_FAILED: 'Failed to lookup location.',
    COORDINATES_LOOKUP_FAILED: 'Failed to lookup coordinates.',
    INVALID_COORDINATES: 'Invalid coordinates provided.',
    COORDINATES_OUT_OF_RANGE: 'Coordinates out of valid range.',

    MUTE_MODE_UPDATE_FAILED: 'Failed to update mute mode.',
    MUTE_MODE_QUERY_FAILED: 'Failed to query mute mode.',
    MUTE_MODE_TOGGLE_FAILED: 'Failed to toggle mute mode.',

    REMINDER_CREATION_FAILED: 'Failed to create reminder.',
    REMINDER_RESCEDULE_FAILED: 'Failed to reschedule reminder.',

    SEARCH_OPERATION_FAILED: 'Search operation failed.',
    INVALID_SEARCH_QUERY: 'Invalid search query.',
    EMPTY_SEARCH_QUERY: 'Empty search query.',
    SEARCH_QUERY_TOO_LONG: 'Search query too long.',
    SEARCH_FILTER_FAILED: 'Failed to filter search results.',

    INVALID_COLOR_FORMAT: 'Invalid color format.',
    EMPTY_COLOR: 'Empty color provided.',
    COLOR_OUT_OF_RANGE: 'Color value out of range.',
    INVALID_RGB_VALUES: 'Invalid RGB values.',

    INVALID_LOGGER_LABEL: 'Invalid logger label provided.',
    LOGGER_CREATION_FAILED: 'Failed to create logger instance.',

    SENTRY_INITIALIZATION_FAILED: 'Failed to initialize Sentry.',

    MISSING_CLIENT_ID: 'Missing Discord client ID.',
    BOT_STARTUP_FAILED: 'Failed to start bot.'
};

/**
 * We get a user-friendly error message based on the error type
 * @param {Error} error - The error object
 * @param {string} context - The context where the error occurred (e.g., 'anime', 'google', etc.)
 * @returns {string} A user-friendly error message
 */
function getErrorMessage(error, context = '') {
    logger.debug("Processing error message.", { 
        errorType: error.name,
        errorCode: error.code,
        context,
        hasResponse: !!error.response
    });

    // Handle Discord API errors
    if (error.code) {
        switch (error.code) {
            case 50001:
                return ERROR_MESSAGES.DISCORD_MISSING_ACCESS;
            case 50013:
                return ERROR_MESSAGES.DISCORD_PERMISSIONS;
            case 10008:
                return ERROR_MESSAGES.DISCORD_MESSAGE_NOT_FOUND;
            case 10011:
                return ERROR_MESSAGES.DISCORD_ROLE_NOT_FOUND;
        }
    }

    // Handle API errors
    if (error.response) {
        switch (error.response.status) {
            case 429:
                return ERROR_MESSAGES.API_RATE_LIMIT;
            case 403:
                return ERROR_MESSAGES.API_ACCESS_DENIED;
            case 404:
                return ERROR_MESSAGES.API_INVALID_RESPONSE;
        }
    }

    // Handle network errors
    if (error.request) {
        return ERROR_MESSAGES.API_NETWORK_ERROR;
    }

    // Handle specific context errors
    if (context === 'anime' && error.message.includes('MAL')) {
        return ERROR_MESSAGES.API_ACCESS_DENIED;
    }

    // Default error message
    return ERROR_MESSAGES.UNEXPECTED_ERROR;
}

/**
 * We log an error with context
 * @param {Error} error - The error object
 * @param {string} context - The context where the error occurred
 * @param {Object} additionalInfo - Additional information to log
 */
function logError(context, error, additionalInfo = {}) {
    logger.error(`${context}:`, {
        error: error.message,
        stack: error.stack,
        ...additionalInfo
    });
}

module.exports = {
    getErrorMessage,
    logError,
    ERROR_MESSAGES
}; 