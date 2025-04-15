const chrono = require('chrono-node');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// We define these configuration constants for consistent time formatting and parsing.
const TIME_FORMAT = 'h:mm A';
const TIME_PATTERN = /\d+\s*:\s*\d+|\d+\s*[ap]\.?m\.?|noon|midnight/i;
const NEXT_DAY_SUFFIX = ' (next day)';
const PREVIOUS_DAY_SUFFIX = ' (previous day)';

// We extend dayjs with plugins for timezone handling to support global time conversions.
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Validates if the provided string is a valid timezone identifier.
 * We use this to prevent errors when working with user-provided timezone strings.
 *
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
 * 
 * We parse the provided content string for time references that specifically
 * include a formatted time (e.g., "3:30pm", "10:00", "2 p.m."). We filter out date-only
 * references to ensure only entries with explicit time components are returned.
 *
 * @param {string} content - The text content to parse for time references.
 * @param {Object} [options={}] - Options for time extraction.
 * @param {boolean} [options.includeAllTimes=false] - Whether to include all time references without filtering.
 * @returns {Array<Object>} An array of objects containing the parsed date and original text.
 */
function extractTimeReferences(content, options = {}) {
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
      .filter(result => {
        if (options.includeAllTimes) {
          return true;
        }
        // We filter for results that contain an explicit time component to avoid ambiguity.
        return TIME_PATTERN.test(result.text);
      })
      .map(result => ({
        date: result.start.date(),
        text: result.text
      }));
  } catch (error) {
    logger.error("Error parsing time references.", { 
      error: error.message, 
      stack: error.stack,
      content: content.substring(0, 100) // We log only first 100 chars for brevity and privacy.
    });
    return [];
  }
}

/**
 * Converts a time reference between two specific timezones.
 * 
 * We use the parsed date from chrono-node and convert it 
 * from the source timezone to the target timezone. We handle day changes
 * and return an object with both the original and converted times.
 *
 * @param {Object} timeRef - The time reference object with text and date properties.
 * @param {string} fromTimezone - The source timezone identifier.
 * @param {string} toTimezone - The target timezone identifier.
 * @returns {Object} An object containing the original text, parsed times, and timezone information.
 */
function convertTimeZones(timeRef, fromTimezone, toTimezone) {
  // We validate input parameters to prevent processing invalid data.
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

  // We validate timezones to ensure they are recognized by the system.
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

    // We get the parsed date (which is in the server's timezone).
    const parsedDate = timeRef.date;
    
    // We extract just the time components to ensure accurate conversion.
    const hours = parsedDate.getHours();
    const minutes = parsedDate.getMinutes();
    const seconds = parsedDate.getSeconds();
    
    // We create a new date in the author's timezone with the same time components.
    const correctDate = dayjs()
      .tz(fromTimezone)
      .hour(hours)
      .minute(minutes)
      .second(seconds);
    
    // We convert to target timezone while preserving the time point.
    const timeInTargetTZ = correctDate.tz(toTimezone);
    
    // We format the times for display according to our standard format.
    const originalTimeFormatted = correctDate.format(TIME_FORMAT);
    const convertedTimeFormatted = timeInTargetTZ.format(TIME_FORMAT);
    
    // We calculate day difference to detect if the time crosses midnight.
    const dayDifference = timeInTargetTZ.date() - correctDate.date();
    const monthDifference = timeInTargetTZ.month() - correctDate.month();
    const yearDifference = timeInTargetTZ.year() - correctDate.year();
    
    // We determine if this is a different day (considering month/year boundaries).
    const isNextDay = dayDifference > 0 || monthDifference > 0 || yearDifference > 0;
    const isPreviousDay = dayDifference < 0 || monthDifference < 0 || yearDifference < 0;
    
    return {
      text: timeRef.text,
      originalTime: originalTimeFormatted,
      convertedTime: convertedTimeFormatted,
      fromTimezone,
      toTimezone,
      dayDifference,
      isNextDay,
      isPreviousDay
    };
  } catch (error) {
    logger.error("Error converting time zones.", { 
      error: error.message,
      stack: error.stack, 
      timeRef,
      fromTimezone,
      toTimezone 
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
 * Default formatter for time conversion results.
 * We use this to create a consistent, human-readable output format.
 * 
 * @param {Object} conversion - A time conversion result object.
 * @returns {string} Formatted string representation.
 */
function defaultFormatter(conversion) {
  const { originalTime, convertedTime, fromTimezone, toTimezone, isNextDay, isPreviousDay } = conversion;
  
  if (!originalTime) {
    return conversion.convertedTime;
  }
  
  // We add a day indicator if the time crosses midnight in either direction.
  let dayIndicator = '';
  if (isNextDay) {
    dayIndicator = NEXT_DAY_SUFFIX;
  } else if (isPreviousDay) {
    dayIndicator = PREVIOUS_DAY_SUFFIX;
  }
  
  return `${convertedTime} is ${originalTime}${dayIndicator} in your timezone.`;
}

/**
 * Formats an array of converted time objects into a human-readable string.
 * 
 * We take an array of time conversion results and format them
 * into a string using either the default formatter or a custom formatter function.
 * This allows for flexible output formatting based on the context.
 *
 * @param {Array<Object>} convertedTimes - Array of time conversion objects.
 * @param {Function} [formatter=defaultFormatter] - Custom formatter function.
 * @returns {string} A formatted string showing the time conversions.
 */
function formatConvertedTimes(convertedTimes, formatter = defaultFormatter) {
  if (!Array.isArray(convertedTimes) || convertedTimes.length === 0) {
    logger.debug("No time conversions to format.");
    return "";
  }
  
  return convertedTimes.map(formatter).join('\n');
}

/**
 * Note on Discord message visibility:
 * When implementing commands that use these time utilities, we should follow these guidelines:
 * 1. Time conversion results should be public (visible to everyone) when they provide
 *    useful information that others in different timezones might benefit from seeing.
 * 2. Error messages for invalid timezones or parsing failures should be ephemeral
 *    (only visible to the command issuer) to avoid cluttering the channel.
 * 
 * Example implementation in a command:
 * ```
 * const userTimezone = await getUserTimezone(interaction.user.id) || 'UTC';
 * const targetTimezone = args.timezone || userTimezone;
 * 
 * if (!isValidTimezone(targetTimezone)) {
 *   // Ephemeral error response
 *   return interaction.reply({ 
 *     content: `⚠️ Invalid timezone: "${targetTimezone}". Please provide a valid timezone.`,
 *     ephemeral: true 
 *   });
 * }
 * 
 * const timeRefs = extractTimeReferences(args.timeString);
 * if (timeRefs.length === 0) {
 *   // Ephemeral error response
 *   return interaction.reply({ 
 *     content: "⚠️ No valid time references found in your message.",
 *     ephemeral: true 
 *   });
 * }
 * 
 * const conversions = timeRefs.map(ref => 
 *   convertTimeZones(ref, userTimezone, targetTimezone)
 * );
 * 
 * // Public response with time conversions
 * await interaction.reply(formatConvertedTimes(conversions));
 * ```
 */
module.exports = {
  extractTimeReferences,
  convertTimeZones,
  formatConvertedTimes,
  isValidTimezone,
  defaultFormatter
};
