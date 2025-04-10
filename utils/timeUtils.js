const chrono = require('chrono-node');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Configure Day.js with the necessary plugins
dayjs.extend(utc);
dayjs.extend(timezone);

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

/**
 * Converts a time reference from one timezone to another
 * 
 * @param {Object} timeRef - The time reference object containing text and date
 * @param {string} fromTimezone - The source timezone (e.g., 'America/New_York')
 * @param {string} toTimezone - The target timezone (e.g., 'America/Los_Angeles')
 * @return {Object} - The converted time reference with original and converted times
 */
function convertTimeZones(timeRef, fromTimezone, toTimezone) {
  // Extract the time from the reference
  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/;
  const match = timeRef.text.match(timeRegex);
  
  if (!match) {
    return {
      text: timeRef.text,
      originalTime: null,
      convertedTime: "Could not parse time",
      fromTimezone: fromTimezone,
      toTimezone: toTimezone
    };
  }
  
  // Extract hours, minutes, and am/pm
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3] ? match[3].toLowerCase() : null;
  
  // Adjust hours for 12-hour format if am/pm is specified
  if (ampm === 'pm' && hours < 12) {
    hours += 12;
  } else if (ampm === 'am' && hours === 12) {
    hours = 0;
  }
  
  // Get the current date in the source timezone
  const now = dayjs().tz(fromTimezone);
  
  // Create a Day.js object with the specified time in the source timezone
  const timeInSourceTZ = now.hour(hours).minute(minutes).second(0);
  
  // Convert to the target timezone
  const timeInTargetTZ = timeInSourceTZ.tz(toTimezone);
  
  // Format the times
  const originalTimeFormatted = timeInSourceTZ.format('h:mm A');
  const convertedTimeFormatted = timeInTargetTZ.format('h:mm A');
  
  return {
    text: timeRef.text,
    originalTime: originalTimeFormatted,
    convertedTime: convertedTimeFormatted,
    fromTimezone: fromTimezone,
    toTimezone: toTimezone
  };
}

/**
 * Format converted time references for display
 * 
 * @param {Array} convertedTimes - Array of converted time references
 * @return {string} - Formatted string for display
 */
function formatConvertedTimes(convertedTimes) {
  return convertedTimes.map(conversion => {
    const { text, originalTime, convertedTime, fromTimezone, toTimezone } = conversion;
    if (originalTime) {
      return `**"${text}"**: ${originalTime} (${fromTimezone}) → ${convertedTime} (${toTimezone})`;
    } else {
      return `**"${text}"**: ${convertedTime}`;
    }
  }).join('\n');
}

module.exports = {
  extractTimeReferences,
  containsTimeReference,
  createTimestampResponse,
  convertTimeToTimezone,
  convertTimeZones,
  formatConvertedTimes
};
