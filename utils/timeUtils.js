const chrono = require('chrono-node');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const moment = require('moment-timezone');
const Sentry = require('../sentry');

// We define these configuration constants for consistent time formatting and parsing.
const TIME_FORMAT = 'h:mm A';
const DATE_FORMAT = 'MMM D'; // Format for displaying the date (e.g., "Apr 17").
const TIME_PATTERN = /\d+\s*:\s*\d+|\d+\s*[ap]\.?m\.?|noon|midnight/i;

// We extend dayjs with UTC support for time conversions.
dayjs.extend(utc);

// We use these configuration constants for timezone handling.
const TIMEZONE_CACHE_DURATION = 3600000; // 1 hour cache duration.
const TIMEZONE_CACHE = new Map(); // We store timezone validation results.

// Get all valid timezone names from moment.
const VALID_TIMEZONES = new Set(moment.tz.names());

// We define these configuration constants for consistent time handling.
const DEFAULT_TIMEZONE = 'UTC';
const TIME_FORMATS = {
  SHORT: 'HH:mm',
  MEDIUM: 'HH:mm:ss',
  LONG: 'YYYY-MM-DD HH:mm:ss',
  ISO: 'YYYY-MM-DDTHH:mm:ss.SSSZ'
};

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
 * We validate a timezone string.
 * @param {string} timezone - The timezone to validate.
 * @returns {boolean} True if the timezone is valid.
 */
function validateTimezone(timezone) {
  if (!timezone || typeof timezone !== 'string') {
    return false;
  }

  // We check the cache first.
  if (TIMEZONE_CACHE.has(timezone)) {
    const { isValid, expiresAt } = TIMEZONE_CACHE.get(timezone);
    if (Date.now() < expiresAt) {
      return isValid;
    }
  }

  // Check if the timezone is in our list of valid timezones.
  const isValid = VALID_TIMEZONES.has(timezone);
  
  // Cache the result.
  TIMEZONE_CACHE.set(timezone, {
    isValid,
    expiresAt: Date.now() + TIMEZONE_CACHE_DURATION
  });

  return isValid;
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
  if (!validateTimezone(fromTimezone) || !validateTimezone(toTimezone)) {
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
    
    // We store the full date information for both timezones.
    const originalDateFormatted = correctDate.format(DATE_FORMAT);
    const convertedDateFormatted = timeInTargetTZ.format(DATE_FORMAT);
    
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
      originalDate: originalDateFormatted,
      convertedDate: convertedDateFormatted,
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
 * Formats a timezone identifier into a more readable format.
 * @param {string} timezone - The timezone identifier (e.g., "America/New_York").
 * @returns {string} Formatted timezone name (e.g., "America/New York").
 */
function formatTimezoneName(timezone) {
  if (!timezone) return '';
  
  return timezone
    .split('/')
    .map(part => {
      // Split by underscore and capitalize each word.
      return part
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    })
    .join('/');
}

/**
 * Default formatter for time conversion results.
 * We use this to create a consistent, human-readable output format.
 * 
 * @param {Object} conversion - A time conversion result object.
 * @returns {string} Formatted string representation.
 */
function defaultFormatter(conversion) {
  const { 
    originalTime, 
    convertedTime, 
    originalDate, 
    convertedDate, 
    fromTimezone, 
    toTimezone, 
    isNextDay, 
    isPreviousDay 
  } = conversion;
  
  if (!originalTime) {
    return conversion.convertedTime;
  }
  
  const formattedFromTimezone = formatTimezoneName(fromTimezone);
  const formattedToTimezone = formatTimezoneName(toTimezone);
  
  // If dates are different, include them in the output.
  if (isNextDay || isPreviousDay) {
    return `${convertedTime} (${convertedDate}) in ${formattedToTimezone} is ${originalTime} (${originalDate}) in ${formattedFromTimezone}.`;
  }
  
  // If same day, use simpler format but include timezones.
  return `${convertedTime} in ${formattedToTimezone} is ${originalTime} in ${formattedFromTimezone}.`;
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
 * We format a date according to the specified format.
 * This function handles date formatting with timezone support.
 *
 * We validate the input date and format string.
 * We apply the specified timezone and format the date accordingly.
 * We handle invalid dates gracefully with appropriate error messages.
 *
 * @param {Date|string} date - The date to format
 * @param {string} format - The format string to use
 * @param {string} timezone - The timezone to use (defaults to UTC)
 * @returns {string} The formatted date string
 * @throws {Error} If the date is invalid or format is unsupported
 */
function formatDate(date, format = DATE_FORMAT, timezone = DEFAULT_TIMEZONE) {
  try {
    // We validate the input date.
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) {
      throw new Error('Invalid date provided.');
    }

    // We validate the format string.
    if (!Object.values(TIME_FORMATS).includes(format)) {
      throw new Error('Unsupported date format.');
    }

    // We format the date using the specified timezone.
    return dayjs(dateObj).tz(timezone).format(format);
  } catch (error) {
    logger.error(`Error formatting date: ${error.message}`);
    throw error;
  }
}

/**
 * We parse a date string into a Date object.
 * This function handles various date string formats.
 *
 * We attempt to parse the date string using multiple formats.
 * We validate the parsed date and return it if valid.
 * We handle invalid dates gracefully with appropriate error messages.
 *
 * @param {string} dateString - The date string to parse
 * @param {string} format - The expected format of the date string
 * @returns {Date} The parsed Date object
 * @throws {Error} If the date string cannot be parsed
 */
function parseDate(dateString, format = DATE_FORMAT) {
  try {
    // We validate the input string.
    if (!dateString || typeof dateString !== 'string') {
      throw new Error('Invalid date string provided.');
    }

    // We parse the date using the specified format.
    const parsedDate = dayjs(dateString, format);
    if (!parsedDate.isValid()) {
      throw new Error('Date string could not be parsed.');
    }

    return parsedDate.toDate();
  } catch (error) {
    logger.error(`Error parsing date string "${dateString}": ${error.message}`);
    throw error;
  }
}

/**
 * We calculate the time difference between two dates.
 * This function handles various time units and formats.
 *
 * We validate both input dates and ensure they are valid.
 * We calculate the difference in the specified unit.
 * We handle invalid dates gracefully with appropriate error messages.
 *
 * @param {Date|string} date1 - The first date
 * @param {Date|string} date2 - The second date
 * @param {string} unit - The unit to calculate the difference in (e.g., 'days', 'hours')
 * @returns {number} The time difference in the specified unit
 * @throws {Error} If either date is invalid
 */
function getTimeDifference(date1, date2, unit = 'days') {
  try {
    // We validate both input dates.
    const dateObj1 = date1 instanceof Date ? date1 : new Date(date1);
    const dateObj2 = date2 instanceof Date ? date2 : new Date(date2);
    
    if (isNaN(dateObj1.getTime()) || isNaN(dateObj2.getTime())) {
      throw new Error('Invalid date provided.');
    }

    // We calculate the difference in the specified unit.
    return dayjs(dateObj1).diff(dayjs(dateObj2), unit);
  } catch (error) {
    logger.error(`Error calculating time difference: ${error.message}`);
    throw error;
  }
}

/**
 * We check if a date is within a specified range.
 * This function handles date range validation.
 *
 * We validate all input dates and ensure they are valid.
 * We check if the target date falls within the range.
 * We handle invalid dates gracefully with appropriate error messages.
 *
 * @param {Date|string} date - The date to check
 * @param {Date|string} startDate - The start of the range
 * @param {Date|string} endDate - The end of the range
 * @returns {boolean} Whether the date is within the range
 * @throws {Error} If any date is invalid
 */
function isDateInRange(date, startDate, endDate) {
  try {
    // We validate all input dates.
    const dateObj = date instanceof Date ? date : new Date(date);
    const startObj = startDate instanceof Date ? startDate : new Date(startDate);
    const endObj = endDate instanceof Date ? endDate : new Date(endDate);
    
    if (isNaN(dateObj.getTime()) || isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
      throw new Error('Invalid date provided.');
    }

    // We check if the date is within the range.
    return dayjs(dateObj).isAfter(startObj) && dayjs(dateObj).isBefore(endObj);
  } catch (error) {
    logger.error(`Error checking date range: ${error.message}`);
    throw error;
  }
}

/**
 * We export the time utility functions for use throughout the application.
 * This module provides consistent time handling capabilities.
 */
module.exports = {
  extractTimeReferences,
  convertTimeZones,
  formatConvertedTimes,
  isValidTimezone,
  defaultFormatter,
  validateTimezone,
  formatDate,
  parseDate,
  getTimeDifference,
  isDateInRange,
  TIME_FORMATS
};