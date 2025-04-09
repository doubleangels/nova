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

module.exports = {
  extractTimeReferences,
  containsTimeReference,
  createTimestampResponse
};
