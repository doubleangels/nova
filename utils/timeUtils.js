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
    // Configure chrono to be more precise with time parsing
    const customChrono = chrono.casual.clone();
    
    // Add a custom parser to handle timezone-aware parsing
    customChrono.parsers.push({
      pattern: () => TIME_PATTERN,
      extract: (context, match) => {
        const text = match[0];
        const date = chrono.parseDate(text);
        
        // If we have a valid date, extract just the time components
        if (date) {
          // Get the hours and minutes from the parsed date
          const hours = date.getHours();
          const minutes = date.getMinutes();
          
          // Create a new reference date (without timezone conversion)
          const refDate = new Date();
          refDate.setHours(hours, minutes, 0, 0);
          
          logger.debug("Time parsing details:", {
            originalText: text,
            parsedHours: hours,
            parsedMinutes: minutes,
            refDate: refDate.toISOString(),
            timeOnly: true
          });
          
          return {
            text: text,
            date: refDate,
            start: { timeOnly: true }  // Flag to indicate this is only time without timezone context
          };
        }
        return null;
      }
    });

    const results = customChrono.parse(content);
    logger.debug("Parsed time references from content.", { 
      count: results.length, 
      contentLength: content.length,
      results: results.map(r => ({
        text: r.text,
        date: r.start.date().toISOString(),
        hours: r.start.date().getHours(),
        minutes: r.start.date().getMinutes(),
        timeOnly: r.start.timeOnly || false
      }))
    });
    
    return results
      .filter(result => TIME_PATTERN.test(result.text))
      .map(result => ({
        date: result.start.date(),
        text: result.text,
        timeOnly: result.start.timeOnly || false
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

    // Always treat time references like "8pm" as time-only
    const isTimeOnly = true;  // We assume all are time-only for conversion purposes
    
    // Handle time-only references by creating a time in the source timezone
    let sourceTime;
    if (isTimeOnly) {
      // For time references, interpret the time in the source timezone
      const hours = timeRef.date.getHours();
      const minutes = timeRef.date.getMinutes();
      
      // Create a current date in the source timezone
      const now = dayjs().tz(fromTimezone);
      // Apply just the hours and minutes, keeping the date the same
      sourceTime = now.hour(hours).minute(minutes);
      
      logger.debug("Interpreting time reference in source timezone:", {
        text: timeRef.text,
        hours,
        minutes,
        fromTimezone,
        sourceTime: sourceTime.format()
      });
    } else {
      // For full datetime references, use the specified date in the source timezone
      sourceTime = dayjs.tz(timeRef.date, fromTimezone);
    }
    
    // If source and target timezones are the same, return the original time
    if (fromTimezone === toTimezone) {
      return {
        text: timeRef.text,
        originalTime: sourceTime.format(TIME_FORMAT),
        targetTime: sourceTime,
        toTimezone
      };
    }
    
    // Convert to target timezone
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
    logger.error("Error converting time zones.", { 
      error: error.message,
      stack: error.stack, 
      timeRef,
      fromTimezone,
      toTimezone,
      originalText: timeRef.text,
      parsedDate: timeRef.date?.toISOString()
    });
    
    Sentry.captureException(error, {
      extra: {
        timeRef,
        fromTimezone,
        toTimezone,
        originalText: timeRef.text,
        parsedDate: timeRef.date?.toISOString()
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
  if (!convertedTimes || convertedTimes.length === 0) {
    return "No times to convert.";
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