const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

/**
 * Validates if a timezone string is valid
 * @param {string} tz - The timezone string to validate
 * @returns {boolean} True if the timezone is valid
 * @throws {Error} If the timezone string is invalid
 */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') {
    throw new Error("⚠️ Invalid timezone provided.");
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
 * Extracts time references from a message content
 * @param {string} content - The message content to parse
 * @returns {Array<{text: string, date: Date, timeOnly: boolean}>} Array of time references found
 * @throws {Error} If parsing fails or no content provided
 */
function extractTimeReferences(content) {
  if (!content) {
    throw new Error("⚠️ No time reference provided.");
  }
  try {
    let cleaned = content.replace(/https?:\/\/\S+/gi, '');
    cleaned = cleaned.replace(/<[^>]*>/g, '');

    const matches = cleaned.match(/\d+\s*:\s*\d+|\d+\s*[ap]\.?(?:m\.?|m)|noon|midnight/gi);
    if (!matches) return [];

    const results = matches.map(text => {
      let parsedTime;
      if (text.toLowerCase() === 'noon') {
        parsedTime = dayjs().hour(12).minute(0);
      } else if (text.toLowerCase() === 'midnight') {
        parsedTime = dayjs().hour(0).minute(0);
      } else {
        const timeStr = text.replace(/\s+/g, '');
        const formats = ['h:mma', 'h:mm a', 'ha', 'h a', 'H:mm'];
        for (const format of formats) {
          parsedTime = dayjs(timeStr, format);
          if (parsedTime.isValid()) break;
        }
        if (!parsedTime.isValid()) {
          const [hours, minutes] = timeStr.split(':').map(Number);
          if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
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
    logger.error('Error parsing time references', {
      error: error.stack,
      message: error.message
    });
    throw new Error("⚠️ Failed to parse time reference.");
  }
}

/**
 * Converts a time reference between timezones
 * @param {{text: string, date: Date}} timeRef - The time reference to convert
 * @param {string} fromTimezone - The source timezone
 * @param {string} toTimezone - The target timezone
 * @returns {{text: string, originalTime: string, targetTime: dayjs, toTimezone: string}} Converted time information
 * @throws {Error} If conversion fails or timezones are invalid
 */
function convertTimeZones(timeRef, fromTimezone, toTimezone) {
  if (!timeRef || !timeRef.text) {
    throw new Error("⚠️ Invalid time reference provided.");
  }

  if (!isValidTimezone(fromTimezone) || !isValidTimezone(toTimezone)) {
    throw new Error("⚠️ Invalid timezone provided.");
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
        originalTime: sourceTime.format('h:mm A'),
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
      sourceFormatted: sourceTime.format('h:mm A'),
      targetFormatted: targetTime.format('h:mm A'),
      timezoneDifference: (targetTime.utcOffset() - sourceTime.utcOffset()) / 60,
      isSameTimezone: fromTimezone === toTimezone,
      isTimeOnly
    });
    
    return {
      text: timeRef.text,
      originalTime: sourceTime.format('h:mm A'),
      targetTime,
      toTimezone
    };
  } catch (error) {
    logger.error('Error converting time zones', {
      error: error.stack,
      message: error.message
    });
    throw new Error("⚠️ Failed to convert time between timezones.");
  }
}

/**
 * Generates a Discord timestamp string
 * @param {dayjs} date - The date to format
 * @param {string} timezone - The timezone to use
 * @returns {string} Discord timestamp string
 * @throws {Error} If parameters are invalid
 */
function generateDiscordTimestamp(date, timezone) {
  if (!date || !timezone) {
    throw new Error("⚠️ Invalid timestamp parameters provided.");
  }
  const timestamp = date.tz(timezone).unix();
  return `<t:${timestamp}:t>`;
}

/**
 * Default formatter for time conversions
 * @param {{originalTime: string, targetTime: dayjs, toTimezone: string}} conversion - The conversion result
 * @returns {string} Formatted time string
 * @throws {Error} If conversion is invalid
 */
function defaultFormatter(conversion) {
  if (!conversion) {
    throw new Error("⚠️ Invalid time conversion provided.");
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
 * Formats an array of converted times into a readable string
 * @param {Array<{text: string, targetTime: dayjs, toTimezone: string, error?: string}>} convertedTimes - Array of converted times
 * @returns {string} Formatted string of all conversions
 * @throws {Error} If no times are provided
 */
function formatConvertedTimes(convertedTimes) {
  if (!convertedTimes || convertedTimes.length === 0) {
    throw new Error("⚠️ No times provided for conversion.");
  }

  const formattedTimes = convertedTimes.map(conversion => {
    if (conversion.error) {
      return `"${conversion.text}" - ${conversion.error}`;
    }
    
    if (!conversion.targetTime) {
      return `"${conversion.text}" - Could not parse time`;
    }

    return `"${conversion.text}" → ${conversion.targetTime.format('h:mm A')} (${conversion.toTimezone})`;
  });

  return formattedTimes.join('\n');
}

/**
 * Handles errors that occur during time operations
 * @param {Error} error - The error that occurred
 * @param {string} context - The context where the error occurred
 * @throws {Error} A formatted error message based on the error type
 */
function handleError(error, context) {
  logger.error(`Error in ${context}:`, {
    error: error.message,
    stack: error.stack
  });

  if (error.message === "INVALID_TIMEZONE") {
    throw new Error("⚠️ Invalid timezone provided.");
  } else if (error.message === "INVALID_DATE") {
    throw new Error("⚠️ Invalid date format provided.");
  } else if (error.message === "INVALID_TIME") {
    throw new Error("⚠️ Invalid time format provided.");
  } else if (error.message === "PAST_DATE") {
    throw new Error("⚠️ Cannot set time for past date.");
  } else {
    throw new Error("⚠️ An unexpected error occurred while processing time.");
  }
}

module.exports = {
  extractTimeReferences,
  convertTimeZones,
  formatConvertedTimes,
  isValidTimezone
};