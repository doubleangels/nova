const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const moment = require('moment-timezone');
const Sentry = require('../sentry');
const { logError, ERROR_MESSAGES } = require('../errors');

// We define these configuration constants for consistent time formatting and parsing.
const TIME_FORMAT = 'h:mm A';
const TIME_PATTERN = /\d+\s*:\s*\d+|\d+\s*[ap]\.?m\.?|noon|midnight/i;

// We extend dayjs with UTC and timezone support for time conversions.
dayjs.extend(utc);
dayjs.extend(timezone);

// We get all valid timezone names from moment for timezone validation.
const VALID_TIMEZONES = new Set(moment.tz.names());

/**
 * We validate if the provided string is a valid timezone identifier.
 * This function ensures that timezone operations will work correctly.
 * 
 * @param {string} tz - The timezone identifier to validate.
 * @returns {boolean} Whether the timezone is valid.
 */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') {
    throw new Error(ERROR_MESSAGES.INVALID_TIMEZONE);
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
 * We extract time references from a text string using dayjs.
 * This function parses natural language time expressions into structured data.
 * 
 * @param {string} content - The text content to parse for time references.
 * @returns {Array<Object>} An array of objects containing the parsed date and original text.
 */
function extractTimeReferences(content) {
  if (!content) {
    throw new Error(ERROR_MESSAGES.EMPTY_TIME_REFERENCE);
  }
  
  try {
    const matches = content.match(TIME_PATTERN);
    if (!matches) return [];

    const results = matches.map(text => {
      // Try to parse the time using dayjs
      let parsedTime;
      
      // Handle noon/midnight
      if (text.toLowerCase() === 'noon') {
        parsedTime = dayjs().hour(12).minute(0);
      } else if (text.toLowerCase() === 'midnight') {
        parsedTime = dayjs().hour(0).minute(0);
      } else {
        // Handle regular time formats
        const timeStr = text.replace(/\s+/g, '');
        parsedTime = dayjs(timeStr, ['h:mma', 'h:mm a', 'h:mm', 'ha', 'h a']);
      }

      if (!parsedTime.isValid()) {
        logger.debug("Failed to parse time:", { text });
        return null;
      }

      logger.debug("Time parsing details:", {
        originalText: text,
        parsedTime: parsedTime.format(),
        timeOnly: true
      });

      return {
        text,
        date: parsedTime.toDate(),
        timeOnly: true
      };
    }).filter(Boolean);

    logger.debug("Parsed time references from content.", { 
      count: results.length, 
      contentLength: content.length,
      results: results.map(r => ({
        text: r.text,
        date: r.date.toISOString(),
        hours: r.date.getHours(),
        minutes: r.date.getMinutes(),
        timeOnly: r.timeOnly
      }))
    });
    
    return results;
  } catch (error) {
    logError('Error parsing time references', error);
    throw new Error(ERROR_MESSAGES.TIME_PARSE_FAILED);
  }
}

/**
 * We convert a time reference between two specific timezones.
 * This function handles the conversion of times between different timezone contexts.
 * 
 * @param {Object} timeRef - The time reference object with text and date properties.
 * @param {string} fromTimezone - The source timezone identifier.
 * @param {string} toTimezone - The target timezone identifier.
 * @returns {Object} An object containing the original text, parsed times, and timezone information.
 */
function convertTimeZones(timeRef, fromTimezone, toTimezone) {
  if (!timeRef || !timeRef.text) {
    throw new Error(ERROR_MESSAGES.INVALID_TIME_REFERENCE);
  }

  if (!isValidTimezone(fromTimezone) || !isValidTimezone(toTimezone)) {
    throw new Error(ERROR_MESSAGES.INVALID_TIMEZONE);
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

    const isTimeOnly = true;
    
    // We handle time-only references by creating a time in the source timezone.
    let sourceTime;
    if (isTimeOnly) {
      const hours = timeRef.date.getHours();
      const minutes = timeRef.date.getMinutes();
      
      const now = dayjs().tz(fromTimezone);
      sourceTime = now.hour(hours).minute(minutes);
      
      logger.debug("Interpreting time reference in source timezone:", {
        text: timeRef.text,
        hours,
        minutes,
        fromTimezone,
        sourceTime: sourceTime.format()
      });
    } else {
      sourceTime = dayjs.tz(timeRef.date, fromTimezone);
    }
    
    if (fromTimezone === toTimezone) {
      return {
        text: timeRef.text,
        originalTime: sourceTime.format(TIME_FORMAT),
        targetTime: sourceTime,
        toTimezone
      };
    }
    
    const targetTime = sourceTime.tz(toTimezone);
    
    logger.debug("Time conversion details:", {
      fromTimezone,
      toTimezone,
      sourceTime: sourceTime.format(),
      targetTime: targetTime.format(),
      sourceOffset: sourceTime.utcOffset(),
      targetOffset: targetTime.utcOffset(),
      parsedDate: timeRef.date.toISOString(),
      originalText: timeRef.text,
      sourceFormatted: sourceTime.format(TIME_FORMAT),
      targetFormatted: targetTime.format(TIME_FORMAT),
      timezoneDifference: (targetTime.utcOffset() - sourceTime.utcOffset()) / 60,
      isSameTimezone: fromTimezone === toTimezone,
      isTimeOnly
    });
    
    return {
      text: timeRef.text,
      originalTime: sourceTime.format(TIME_FORMAT),
      targetTime,
      toTimezone
    };
  } catch (error) {
    logError('Error converting time zones', error);
    throw new Error(ERROR_MESSAGES.TIME_CONVERSION_FAILED);
  }
}

/**
 * We generate Discord dynamic timestamps for a given date in a specific timezone.
 * This function creates formatted timestamp strings for Discord messages.
 * 
 * @param {dayjs.Dayjs} date - The date object.
 * @param {string} timezone - The timezone to use.
 * @returns {string} Discord timestamp format string.
 */
function generateDiscordTimestamp(date, timezone) {
  if (!date || !timezone) {
    throw new Error(ERROR_MESSAGES.INVALID_TIMESTAMP_PARAMS);
  }
  const timestamp = date.tz(timezone).unix();
  return `<t:${timestamp}:t>`;
}

/**
 * We format time conversion results into a default string representation.
 * This function provides a consistent format for displaying converted times.
 * 
 * @param {Object} conversion - A time conversion result object.
 * @returns {string} Formatted string representation.
 */
function defaultFormatter(conversion) {
  if (!conversion) {
    throw new Error(ERROR_MESSAGES.INVALID_CONVERSION);
  }
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
 * We format an array of converted time objects into a human-readable string.
 * This function creates a formatted output of multiple time conversions.
 * 
 * @param {Array<Object>} convertedTimes - Array of time conversion objects.
 * @returns {string} A formatted string showing the time conversions.
 */
function formatConvertedTimes(convertedTimes) {
  if (!convertedTimes || convertedTimes.length === 0) {
    throw new Error(ERROR_MESSAGES.NO_TIMES_TO_CONVERT);
  }

  const formattedTimes = convertedTimes.map(conversion => {
    if (conversion.error) {
      return `"${conversion.text}" - ${conversion.error}`;
    }
    
    if (!conversion.targetTime) {
      return `"${conversion.text}" - Could not parse time`;
    }

    return `"${conversion.text}" → ${conversion.targetTime.format(TIME_FORMAT)} (${conversion.toTimezone})`;
  });

  return formattedTimes.join('\n');
}

/**
 * We export the time utility functions for use throughout the application.
 * This module provides consistent time handling and conversion capabilities.
 */
module.exports = {
  extractTimeReferences,
  convertTimeZones,
  formatConvertedTimes,
  isValidTimezone
};