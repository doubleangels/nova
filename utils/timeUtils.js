const chrono = require('chrono-node');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Extend dayjs with plugins for timezone handling
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Extracts time references from a text string using chrono-node.
 * 
 * This function parses the provided content string for time references that specifically
 * include a formatted time (e.g., "3:30pm", "10:00", "2 p.m."). It filters out date-only
 * references to ensure only entries with explicit time components are returned.
 *
 * @param {string} content - The text content to parse for time references.
 * @returns {Array<Object>} An array of objects containing the parsed date and original text.
 */
function extractTimeReferences(content) {
  if (!content) return [];
  try {
    const results = chrono.parse(content);
    return results
      .filter(result => {
        // Only include results that have a time component (HH:MM or with AM/PM)
        return result.text.match(/\d+\s*:\s*\d+|\d+\s*[ap]\.?m\.?/i) !== null;
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
 * Converts a time reference between two specific timezones.
 * 
 * This function parses a time reference, extracts the hours and minutes,
 * and converts it from the source timezone to the target timezone. It handles
 * AM/PM designations and returns an object with both the original and converted times.
 *
 * @param {Object} timeRef - The time reference object with text and date properties.
 * @param {string} fromTimezone - The source timezone identifier.
 * @param {string} toTimezone - The target timezone identifier.
 * @returns {Object} An object containing the original text, parsed times, and timezone information.
 */
function convertTimeZones(timeRef, fromTimezone, toTimezone) {
  // Regular expression to extract time components (hours, minutes, AM/PM)
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
  
  // Parse time components
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3] ? match[3].toLowerCase() : null;
  
  // Adjust hours for 12-hour format if AM/PM is specified
  if (ampm === 'pm' && hours < 12) {
    hours += 12;
  } else if (ampm === 'am' && hours === 12) {
    hours = 0;
  }
  
  // Create dayjs objects for the source and target timezones
  const now = dayjs().tz(fromTimezone);
  const timeInSourceTZ = now.hour(hours).minute(minutes).second(0);
  const timeInTargetTZ = timeInSourceTZ.tz(toTimezone);
  
  // Format the times for display
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
 * Formats an array of converted time objects into a human-readable string.
 * 
 * This function takes an array of time conversion results and formats them
 * into a string that shows the original time and timezone alongside the
 * converted time and timezone.
 *
 * @param {Array<Object>} convertedTimes - Array of time conversion objects.
 * @returns {string} A formatted string showing the time conversions.
 */
function formatConvertedTimes(convertedTimes) {
  return convertedTimes.map(conversion => {
    const { text, originalTime, convertedTime, fromTimezone, toTimezone } = conversion;
    if (originalTime) {
      return `${originalTime} (${fromTimezone}) → ${convertedTime} (${toTimezone})`;
    } else {
      return `${convertedTime}`;
    }
  }).join('\n');
}

module.exports = {
  extractTimeReferences,
  convertTimeZones,
  formatConvertedTimes
};
