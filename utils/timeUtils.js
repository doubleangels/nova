// utils/timeUtils.js
const chrono = require('chrono-node');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));

/**
 * Extract time references from a string using chrono-node.
 * 
 * @param {string} content - The message content to check.
 * @returns {Array} Array of objects containing parsed date and original text.
 */
function extractTimeReferences(content) {
  if (!content) return [];
  
  try {
    // Use chrono-node to parse potential dates/times from the message
    const results = chrono.parse(content);
    
    // Filter results to only include those with time components
    return results
      .filter(result => {
        // Check if the parsed result has time information
        return result.text.match(/\d+\s*:\s*\d+|noon|midnight|morning|afternoon|evening|night|[ap]\.?m\.?/i) !== null;
      })
      .map(result => ({
        date: result.start.date(),
        text: result.text
      }));
  } catch (error) {
    logger.error("Error parsing time references:", { error, content });
    return [];
  }
}

/**
 * Checks if a string contains time references using chrono-node.
 * 
 * @param {string} content - The message content to check.
 * @returns {boolean} True if the content contains time references, false otherwise.
 */
function containsTimeReference(content) {
  return extractTimeReferences(content).length > 0;
}

/**
 * Creates a response message with Discord timestamp formats.
 * 
 * @param {Array} timeReferences - Array of parsed time references.
 * @param {string} originalContent - The original message content.
 * @returns {string} Formatted response with Discord timestamps.
 */
function createTimestampResponse(timeReferences, originalContent) {
  let response = "**Time Conversion**\n";
  
  timeReferences.forEach(ref => {
    const timestamp = Math.floor(ref.date.getTime() / 1000);
    
    response += `> "${ref.text}"\n`;
    response += `<t:${timestamp}> (your local time)\n`;
    response += `<t:${timestamp}:F> (full date/time)\n`;
    response += `<t:${timestamp}:R> (relative time)\n\n`;
  });
  
  return response;
}

/**
 * Converts a time reference to the specified timezone
 * 
 * @param {Object} timeReference - The time reference object from chrono-node
 * @param {string} timezone - The target timezone (e.g., 'America/New_York')
 * @return {Object} - The converted time reference
 */
function convertTimeToTimezone(timeReference, timezone) {
  // Clone the time reference to avoid modifying the original
  const convertedRef = { ...timeReference };
  
  // Convert the date to the target timezone
  if (convertedRef.date) {
    const originalDate = new Date(convertedRef.date);
    // Create a new date object with the timezone adjustment
    convertedRef.date = new Date(originalDate.toLocaleString('en-US', { timeZone: timezone }));
    convertedRef.timezone = timezone;
  }
  
  return convertedRef;
}

module.exports = {
  extractTimeReferences,
  containsTimeReference,
  createTimestampResponse,
  convertTimeToTimezone
};
