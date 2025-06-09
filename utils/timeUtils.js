/**
 * Time utilities module for handling time-related operations.
 * Manages timezone conversions, time parsing, and formatting.
 * @module utils/timeUtils
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const moment = require('moment-timezone');
const Sentry = require('../sentry');
const { logError } = require('../errors');

/**
 * Error messages specific to time utilities.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while processing time.",
    INVALID_TIMEZONE: "⚠️ Invalid timezone provided.",
    EMPTY_TIME_REFERENCE: "⚠️ No time reference provided.",
    TIME_PARSE_FAILED: "⚠️ Failed to parse time reference.",
    TIME_CONVERSION_FAILED: "⚠️ Failed to convert time between timezones.",
    INVALID_TIME_REFERENCE: "⚠️ Invalid time reference provided.",
    INVALID_TIMESTAMP_PARAMS: "⚠️ Invalid timestamp parameters provided.",
    INVALID_CONVERSION: "⚠️ Invalid time conversion provided.",
    NO_TIMES_TO_CONVERT: "⚠️ No times provided for conversion.",
    INVALID_DATE: "⚠️ Invalid date provided.",
    INVALID_TIME_FORMAT: "⚠️ Invalid time format provided.",
    TIMEZONE_NOT_FOUND: "⚠️ Timezone not found.",
    INVALID_OFFSET: "⚠️ Invalid timezone offset provided.",
    TIMEZONE_CONVERSION_FAILED: "⚠️ Failed to convert between timezones.",
    INVALID_TIME_RANGE: "⚠️ Invalid time range provided."
};

const TIME_FORMAT = 'h:mm A';
const TIME_PATTERN = /\d+\s*:\s*\d+|\d+\s*[ap]\.?m\.?|noon|midnight/i;

dayjs.extend(utc);
dayjs.extend(timezone);

const VALID_TIMEZONES = new Set(moment.tz.names());

/**
 * Validates if a timezone string is valid.
 * @function isValidTimezone
 * @param {string} tz - The timezone to validate
 * @returns {boolean} Whether the timezone is valid
 * @throws {Error} If timezone is invalid
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
 * Extracts time references from text content.
 * @function extractTimeReferences
 * @param {string} content - The text content to parse
 * @returns {Array<Object>} Array of time reference objects
 * @throws {Error} If time parsing fails
 */
function extractTimeReferences(content) {
  if (!content) {
    throw new Error(ERROR_MESSAGES.EMPTY_TIME_REFERENCE);
  }
  
  try {
    const matches = content.match(TIME_PATTERN);
    if (!matches) return [];

    const results = matches.map(text => {
      let parsedTime;
      
      if (text.toLowerCase() === 'noon') {
        parsedTime = dayjs().hour(12).minute(0);
      } else if (text.toLowerCase() === 'midnight') {
        parsedTime = dayjs().hour(0).minute(0);
      } else {
        const timeStr = text.replace(/\s+/g, '');
        parsedTime = dayjs(timeStr, ['h:mma', 'h:mm a', 'ha', 'h a']);
        
        if (!parsedTime.isValid()) {
          const [hours, minutes] = timeStr.split(':').map(Number);
          if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            const period = hours >= 12 ? 'PM' : 'AM';
            const hour12 = hours % 12 || 12;
            parsedTime = dayjs().hour(hours).minute(minutes);
          }
        }
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
 * Converts time between timezones.
 * @function convertTimeZones
 * @param {Object} timeRef - The time reference object
 * @param {string} fromTimezone - The source timezone
 * @param {string} toTimezone - The target timezone
 * @returns {Object} The converted time information
 * @throws {Error} If timezone conversion fails
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
 * Generates a Discord timestamp string.
 * @function generateDiscordTimestamp
 * @param {Date} date - The date to format
 * @param {string} timezone - The timezone to use
 * @returns {string} Discord timestamp string
 * @throws {Error} If timestamp generation fails
 */
function generateDiscordTimestamp(date, timezone) {
  if (!date || !timezone) {
    throw new Error(ERROR_MESSAGES.INVALID_TIMESTAMP_PARAMS);
  }
  const timestamp = date.tz(timezone).unix();
  return `<t:${timestamp}:t>`;
}

/**
 * Default formatter for time conversions.
 * @function defaultFormatter
 * @param {Object} conversion - The conversion result
 * @returns {string} Formatted time string
 * @throws {Error} If formatting fails
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
 * Formats multiple converted times into a string.
 * @function formatConvertedTimes
 * @param {Array<Object>} convertedTimes - Array of converted time objects
 * @returns {string} Formatted time string
 * @throws {Error} If formatting fails
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

module.exports = {
  extractTimeReferences,
  convertTimeZones,
  formatConvertedTimes,
  isValidTimezone
};