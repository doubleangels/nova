/**
 * Error handling module for the Discord bot.
 * Provides error handling utilities and Discord API error code handling.
 * @module errors
 */

const path = require('path');
const logger = require('./logger')(path.basename(__filename));

/**
 * Gets a user-friendly error message based on the error type and context.
 * @function getErrorMessage
 * @param {Error} error - The error object
 * @param {string} [context=''] - Additional context about where the error occurred
 * @returns {string} A user-friendly error message
 */
function getErrorMessage(error, context = '') {
    logger.debug("Processing error message.", { 
        errorType: error.name,
        errorCode: error.code,
        context,
        hasResponse: !!error.response
    });

    // Handle Discord API error codes
    if (error.code) {
        switch (error.code) {
            case 50001:
                return "⚠️ I don't have access to perform this action. Please check my permissions.";
            case 50013:
                return "⚠️ I don't have the required permissions to execute this command.";
            case 10008:
                return "⚠️ The message could not be found. It may have been deleted.";
            case 10011:
                return "⚠️ The role could not be found. It may have been deleted.";
        }
    }

    // Handle Discord role management errors
    if (error.message === "ROLE_NOT_MANAGEABLE") {
        return "⚠️ I cannot modify this role. It may be managed by an integration or have higher permissions than me.";
    }

    // Handle API response errors
    if (error.response) {
        switch (error.response.status) {
            case 429:
                return "⚠️ API rate limit reached. Please try again in a few moments.";
            case 403:
                return "⚠️ API access denied. Please check API configuration.";
            case 404:
                return "⚠️ Received invalid response from the API. Please try again later.";
        }
    }

    // Handle network errors
    if (error.request) {
        return "⚠️ Network error: Could not connect to the service. Please check your internet connection.";
    }

    // Default error message
    return "⚠️ An unexpected error occurred. Please try again later.";
}

/**
 * Logs an error with additional context and information.
 * @function logError
 * @param {string} context - The context in which the error occurred
 * @param {Error} error - The error object
 * @param {Object} [additionalInfo={}] - Additional information to log
 */
function logError(error, context, additionalInfo = {}) {
    logger.error(`${context}:`, {
        error: error.message,
        stack: error.stack,
        ...additionalInfo
    });
}

module.exports = {
    getErrorMessage,
    logError
}; 