const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);



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

module.exports = {
  extractTimeReferences
};