const chrono = require('chrono-node');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const moment = require('moment-timezone');
const Sentry = require('../sentry');

// Time format constants
const TIME_FORMAT = 'h:mm A';
const TIME_PATTERN = /\d+\s*:\s*\d+|\d+\s*[ap]\.?m\.?|noon|midnight/i;

// Configure dayjs plugins for timezone support
dayjs.extend(utc);
dayjs.extend(timezone);

// Initialize valid timezones set
const VALID_TIMEZONES = new Set(moment.tz.names());

/**
 * Validates if a timezone identifier is valid.
 * 
 * @param {string} tz - Timezone identifier to validate
 * @returns {boolean} True if the timezone is valid, false otherwise
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
 * Extracts time references from a text string.
 * Uses a customized chrono parser to detect time patterns in natural language.
 * 
 * @param {string} content - Text content to parse for time references
 * @returns {Array<Object>} Array of extracted time references with date, text, and timeOnly properties
 */
function extractTimeReferences(content) {
  if (!content) {
    return [];
  }
  
  try {
    // Create a custom chrono parser instance
    const customChrono = chrono.casual.clone();
    
    // Add custom parser for time-only patterns
    customChrono.parsers.push({
      pattern: () => TIME_PATTERN,
      extract: (context, match) => {
        const text = match[0];
        const date = chrono.parseDate(text);
        
        if (date) {
          const hours = date.getHours();
          const minutes = date.getMinutes();
          
          // Create a reference date with just the time component
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
            start: { timeOnly: true }
          };
        }
        return null;
      }
    });

    // Parse the content with the enhanced parser
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
    
    // Filter and transform results
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
 * Converts a time reference from one timezone to another.
 * 
 * @param {Object} timeRef - Time reference object with date and text properties
 * @param {string} fromTimezone - Source timezone identifier
 * @param {string} toTimezone - Target timezone identifier
 * @returns {Object} Conversion result with original and converted time information
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

  // Validate timezone inputs
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
    // Check if timeRef has a valid date
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
    
    // Create source time object
    let sourceTime;
    if (isTimeOnly) {
      // For time-only references, use current date with the specified time
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
      // For full datetime references
      sourceTime = dayjs.tz(timeRef.date, fromTimezone);
    }
    
    // Handle same timezone case
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
    
    // Return successful conversion result
    return {
      text: timeRef.text,
      originalTime: sourceTime.format(TIME_FORMAT),
      targetTime,
      toTimezone
    };
  } catch (error) {
    // Log and report errors
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
    
    // Return error result
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
 * Generates a Discord timestamp format string for a given date and timezone.
 * 
 * @param {Object} date - dayjs date object
 * @param {string} timezone - Timezone identifier
 * @returns {string} Discord formatted timestamp string
 */
function generateDiscordTimestamp(date, timezone) {
  const timestamp = date.tz(timezone).unix();
  return `<t:${timestamp}:t>`;
}

/**
 * Default formatter for a single time conversion.
 * 
 * @param {Object} conversion - Time conversion result
 * @param {string|null} conversion.originalTime - Original time in formatted string
 * @param {Object} conversion.targetTime - Target time as dayjs object
 * @param {string} conversion.toTimezone - Target timezone identifier
 * @returns {string} Formatted conversion result
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
 * Formats an array of time conversion results into a human-readable string.
 * 
 * @param {Array<Object>} convertedTimes - Array of time conversion results
 * @returns {string} Formatted string of all conversions
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