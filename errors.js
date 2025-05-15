/**
 * Centralized error handling and messages for the bot.
 * This module provides consistent error messages and handling across all commands.
 */

const logger = require('./logger')('errors.js');

/**
 * Common error codes and their corresponding messages
 */
const ERROR_MESSAGES = {
    // Discord API Errors
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
    
    // API Errors
    API_RATE_LIMIT: "⚠️ API rate limit reached. Please try again in a few moments.",
    API_ACCESS_DENIED: "⚠️ API access denied. Please check API configuration.",
    API_INVALID_RESPONSE: "⚠️ Received invalid response from the API. Please try again later.",
    API_TIMEOUT: "⚠️ API request timed out. Please try again later.",
    API_NETWORK_ERROR: "⚠️ Network error: Could not connect to the service. Please check your internet connection.",
    API_NO_RESULTS: "⚠️ No results found. Try refining your search query.",
    
    // Database Errors
    DATABASE_READ_ERROR: "⚠️ Failed to retrieve data from the database. Please try again later.",
    DATABASE_WRITE_ERROR: "⚠️ Failed to save data to the database. Please try again later.",
    DATABASE_CONNECTION_ERROR: "⚠️ Database connection error. Please try again later.",
    
    // Configuration Errors
    CONFIG_MISSING: "⚠️ This command is not properly configured. Please contact an administrator.",
    CONFIG_INVALID: "⚠️ Invalid configuration detected. Please contact an administrator.",
    
    // Command-specific Errors
    BACKUP_MODE_NO_SETTINGS: "⚠️ Please provide at least one setting to update (channel, role, or enabled status).",
    BACKUP_MODE_INVALID_CHANNEL: "⚠️ The channel must be a text channel for welcome messages.",
    BACKUP_MODE_INVALID_ROLE: "⚠️ I cannot assign the selected role. Please choose a role that is below my highest role.",
    
    CAT_API_ERROR: "⚠️ Couldn't fetch a cat picture due to an API error. Try again later.",
    CAT_NETWORK_ERROR: "⚠️ Couldn't connect to the cat image service. Please check your internet connection.",
    CAT_INVALID_IMAGE: "⚠️ The cat service didn't send a proper image. Please try again.",
    
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
    
    URBAN_NO_DEFINITION: "⚠️ No definition found for this term.",
    URBAN_INVALID_QUERY: "⚠️ Please provide a valid search term.",
    
    WEATHER_INVALID_LOCATION: "⚠️ Could not find the specified location.",
    WEATHER_API_ERROR: "⚠️ Failed to fetch weather data. Please try again later.",
    
    WIKIPEDIA_NO_RESULTS: "⚠️ No Wikipedia articles found for your search.",
    WIKIPEDIA_INVALID_QUERY: "⚠️ Please provide a valid search query.",
    
    YOUTUBE_INVALID_QUERY: "⚠️ Please provide a valid search query.",
    YOUTUBE_NO_RESULTS: "⚠️ No results found for your search.",
    YOUTUBE_INVALID_DURATION: "⚠️ Invalid duration filter specified.",
    
    // General Errors
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred. Please try again later.",
    VALIDATION_ERROR: "⚠️ Invalid input provided. Please check your command parameters.",
    PERMISSION_ERROR: "⚠️ You don't have permission to use this command.",
    RATE_LIMIT_ERROR: "⚠️ You're being rate limited. Please try again later.",
    TIMEOUT_ERROR: "⚠️ The operation timed out. Please try again later."
};

/**
 * Get a user-friendly error message based on the error type
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
                return ERROR_MESSAGES.API_NOT_FOUND;
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
 * Log an error with context
 * @param {Error} error - The error object
 * @param {string} context - The context where the error occurred
 * @param {Object} additionalInfo - Additional information to log
 */
function logError(error, context, additionalInfo = {}) {
    logger.error(`Error in ${context} command.`, {
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