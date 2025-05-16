const chrono = require('chrono-node');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const moment = require('moment-timezone');
const Sentry = require('../sentry');

// We define these configuration constants for consistent time formatting and parsing.
const TIME_FORMAT = 'h:mm A';
const TIME_PATTERN = /\d+\s*:\s*\d+|\d+\s*[ap]\.?m\.?|noon|midnight/i;

// We extend dayjs with UTC and timezone support for time conversions.
dayjs.extend(utc);
dayjs.extend(timezone);

// Get all valid timezone names from moment.
const VALID_TIMEZONES = new Set(moment.tz.names());

/**
 * Validates if the provided string is a valid timezone identifier.
 * @param {string} tz - The timezone identifier to validate.
 * @returns {boolean} Whether the timezone is valid.
 */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') {
    return false;
  }
  
  try {
    dayjs().tz(tz);
    return true;
  } catch (error) {
    logger.debug("Invalid timezone identifier.", { timezone: tz });
    return false;
  }
}

/**
 * Extracts time references from a text string using chrono-node.
 * @param {string} content - The text content to parse for time references.
 * @returns {Array<Object>} An array of objects containing the parsed date and original text.
 */
function extractTimeReferences(content) {
  if (!content) {
    return [];
  }
  
  try {
    const results = chrono.parse(content);
    logger.debug("Parsed time references from content.", { 
      count: results.length, 
      contentLength: content.length 
    });
    
    return results
      .filter(result => TIME_PATTERN.test(result.text))
      .map(result => ({
        date: result.start.date(),
        text: result.text
      }));
  } catch (error) {
    logger.error("Error parsing time references.", { 
      error: error.message, 
      stack: error.stack,
      content: content.substring(0, 100)
    });
    return [];
  }
}

/**
 * Converts a time reference between two specific timezones.
 * @param {Object} timeRef - The time reference object with text and date properties.
 * @param {string} fromTimezone - The source timezone identifier.
 * @param {string} toTimezone - The target timezone identifier.
 * @returns {Object} An object containing the original text, parsed times, and timezone information.
 */
function convertTimeZones(timeRef, fromTimezone, toTimezone) {
  if (!timeRef || !timeRef.text) {
    logger.debug("Invalid time reference provided.", { timeRef });
    return {
      text: timeRef?.text || "undefined",
      originalTime: null,
      convertedTime: "Could not parse time",
      fromTimezone,
      toTimezone
    };
  }

  if (!isValidTimezone(fromTimezone) || !isValidTimezone(toTimezone)) {
    logger.debug("Invalid timezone in conversion request.", { fromTimezone, toTimezone });
    return {
      text: timeRef.text,
      originalTime: null,
      convertedTime: "Invalid timezone specified",
      fromTimezone,
      toTimezone
    };
  }

  try {
    if (!timeRef.date) {
      return {
        text: timeRef.text,
        originalTime: null,
        convertedTime: "Could not parse time",
        fromTimezone,
        toTimezone
      };
    }

    const parsedDate = timeRef.date;
    
    // Create a dayjs object in the source timezone
    const sourceTime = dayjs.tz(parsedDate, fromTimezone);
    
    // Convert to target timezone
    const targetTime = sourceTime.tz(toTimezone);
    
    logger.debug("Time conversion details:", {
      fromTimezone,
      toTimezone,
      sourceTime: sourceTime.format(),
      targetTime: targetTime.format(),
      sourceOffset: sourceTime.utcOffset(),
      targetOffset: targetTime.utcOffset(),
      parsedDate: parsedDate.toISOString()
    });
    
    return {
      text: timeRef.text,
      originalTime: sourceTime.format(TIME_FORMAT),
      targetTime,
      toTimezone
    };
  } catch (error) {
    logger.error("Error converting time zones.", { 
      error: error.message,
      stack: error.stack, 
      timeRef,
      fromTimezone,
      toTimezone 
    });
    
    Sentry.captureException(error, {
      extra: {
        timeRef,
        fromTimezone,
        toTimezone
      }
    });
    
    return {
      text: timeRef.text,
      originalTime: null,
      convertedTime: "Error converting time",
      fromTimezone,
      toTimezone,
      error: error.message
    };
  }
}

/**
 * Generates Discord dynamic timestamps for a given date in a specific timezone.
 * Always shows time only.
 * @param {dayjs.Dayjs} date - The date object
 * @param {string} timezone - The timezone to use
 * @returns {string} Discord timestamp format string
 */
function generateDiscordTimestamp(date, timezone) {
  const timestamp = date.tz(timezone).unix();
  return `<t:${timestamp}:t>`; // 't' format shows time only (e.g., 3:00 PM)
}

/**
 * Default formatter for time conversion results.
 * @param {Object} conversion - A time conversion result object.
 * @returns {string} Formatted string representation.
 */
function defaultFormatter(conversion) {
  const { 
    originalTime, 
    targetTime,
    toTimezone
  } = conversion;
  
  if (!originalTime) {
    return conversion.convertedTime;
  }
  
  const targetTimestamp = generateDiscordTimestamp(targetTime, toTimezone);
  return `your converted time is ${targetTimestamp} ${toTimezone}.`;
}

/**
 * Formats an array of converted time objects into a human-readable string.
 * @param {Array<Object>} convertedTimes - Array of time conversion objects.
 * @returns {string} A formatted string showing the time conversions.
 */
function formatConvertedTimes(convertedTimes) {
  if (!Array.isArray(convertedTimes) || convertedTimes.length === 0) {
    logger.debug("No time conversions to format.");
    return "";
  }
  
  return convertedTimes.map(defaultFormatter).join('\n');
}

module.exports = {
  extractTimeReferences,
  convertTimeZones,
  formatConvertedTimes,
  isValidTimezone
};