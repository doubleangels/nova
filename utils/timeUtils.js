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
 * Validates if the provided string is a valid timezone identifier.
 *
 * @param {string} tz - The timezone identifier to validate.
 * @returns {boolean} Whether the timezone is valid.
 */
function isValidTimezone(tz) {
  try {
    dayjs().tz(tz);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts time references from a text string using chrono-node.
 * 
 * This function parses the provided content string for time references that specifically
 * include a formatted time (e.g., "3:30pm", "10:00", "2 p.m."). It filters out date-only
 * references to ensure only entries with explicit time components are returned.
 *
 * @param {string} content - The text content to parse for time references.
 * @param {Object} [options={}] - Options for time extraction.
 * @param {boolean} [options.includeAllTimes=false] - Whether to include all time references without filtering.
 * @returns {Array<Object>} An array of objects containing the parsed date and original text.
 */
function extractTimeReferences(content, options = {}) {
  if (!content) return [];
  try {
    const results = chrono.parse(content);
    return results
      .filter(result => {
        if (options.includeAllTimes) return true;
        // Expanded regex to include more time formats
        return result.text.match(/\d+\s*:\s*\d+|\d+\s*[ap]\.?m\.?|noon|midnight/i) !== null;
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
 * This function uses the parsed date from chrono-node and converts it 
 * from the source timezone to the target timezone. It handles day changes
 * and returns an object with both the original and converted times.
 *
 * @param {Object} timeRef - The time reference object with text and date properties.
 * @param {string} fromTimezone - The source timezone identifier.
 * @param {string} toTimezone - The target timezone identifier.
 * @returns {Object} An object containing the original text, parsed times, and timezone information.
 */
function convertTimeZones(timeRef, fromTimezone, toTimezone) {
  // Validate timezones
  if (!isValidTimezone(fromTimezone) || !isValidTimezone(toTimezone)) {
    return {
      text: timeRef.text,
      originalTime: null,
      convertedTime: "Invalid timezone specified",
      fromTimezone: fromTimezone,
      toTimezone: toTimezone
    };
  }

  try {
    if (!timeRef.date) {
      return {
        text: timeRef.text,
        originalTime: null,
        convertedTime: "Could not parse time",
        fromTimezone: fromTimezone,
        toTimezone: toTimezone
      };
    }

    // Get the parsed date (which is in the server's timezone)
    const parsedDate = timeRef.date;
    
    // Extract just the time components
    const hours = parsedDate.getHours();
    const minutes = parsedDate.getMinutes();
    const seconds = parsedDate.getSeconds();
    
    // Create a new date in the author's timezone with the same time components
    const correctDate = dayjs()
      .tz(fromTimezone)
      .hour(hours)
      .minute(minutes)
      .second(seconds);
    
    // Convert to target timezone
    const timeInTargetTZ = correctDate.tz(toTimezone);
    
    // Format the times for display
    const originalTimeFormatted = correctDate.format('h:mm A');
    const convertedTimeFormatted = timeInTargetTZ.format('h:mm A');
    
    // Calculate day difference
    const dayDifference = timeInTargetTZ.date() - correctDate.date();
    const monthDifference = timeInTargetTZ.month() - correctDate.month();
    const yearDifference = timeInTargetTZ.year() - correctDate.year();
    
    // Determine if this is a different day (considering month/year boundaries)
    const isNextDay = dayDifference > 0 || monthDifference > 0 || yearDifference > 0;
    const isPreviousDay = dayDifference < 0 || monthDifference < 0 || yearDifference < 0;
    
    return {
      text: timeRef.text,
      originalTime: originalTimeFormatted,
      convertedTime: convertedTimeFormatted,
      fromTimezone: fromTimezone,
      toTimezone: toTimezone,
      dayDifference: dayDifference,
      isNextDay: isNextDay,
      isPreviousDay: isPreviousDay
    };
  } catch (error) {
    logger.error("Error converting time zones:", { error, timeRef });
    return {
      text: timeRef.text,
      originalTime: null,
      convertedTime: "Error converting time",
      fromTimezone: fromTimezone,
      toTimezone: toTimezone,
      error: error.message
    };
  }
}


/**
 * Default formatter for time conversion results
 * 
 * @param {Object} conversion - A time conversion result object
 * @returns {string} Formatted string representation
 */
function defaultFormatter(conversion) {
  const { originalTime, convertedTime, fromTimezone, toTimezone, isNextDay, isPreviousDay } = conversion;
  
  if (!originalTime) {
    return conversion.convertedTime;
  }
  
  let dayIndicator = '';
  if (isNextDay) {
    dayIndicator = ' (next day)';
  } else if (isPreviousDay) {
    dayIndicator = ' (previous day)';
  }
  
  return `${originalTime} (${fromTimezone}) → ${convertedTime}${dayIndicator} (${toTimezone})`;
}

/**
 * Formats an array of converted time objects into a human-readable string.
 * 
 * This function takes an array of time conversion results and formats them
 * into a string using either the default formatter or a custom formatter function.
 *
 * @param {Array<Object>} convertedTimes - Array of time conversion objects.
 * @param {Function} [formatter=defaultFormatter] - Custom formatter function.
 * @returns {string} A formatted string showing the time conversions.
 */
function formatConvertedTimes(convertedTimes, formatter = defaultFormatter) {
  return convertedTimes.map(formatter).join('\n');
}

module.exports = {
  extractTimeReferences,
  convertTimeZones,
  formatConvertedTimes,
  isValidTimezone,
  defaultFormatter
};
