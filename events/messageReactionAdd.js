const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone } = require('../utils/database');
const { extractTimeReferences, convertTimeZones, formatConvertedTimes } = require('../utils/timeUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Configuration constants.
const CLOCK_EMOJI = '🕒';
const TIME_CONVERSION_TIMEOUT = 15000; // 15 seconds

// Extend dayjs with timezone capabilities.
dayjs.extend(utc);
dayjs.extend(timezone);

module.exports = {
  name: 'messageReactionAdd',
  
  /**
   * Handles the messageReactionAdd event for time conversion functionality.
   * 
   * @param {MessageReaction} reaction - The Discord.js MessageReaction object.
   * @param {User} user - The Discord.js User who added the reaction.
   * @returns {Promise<void>}
   */
  async execute(reaction, user) {
    try {
      // Ignore reactions from bots.
      if (user.bot) return;
      
      // Handle partial reactions and messages
      await fetchPartialData(reaction);
      
      logger.debug("Reaction added:", {
        emoji: reaction.emoji.name,
        messageId: reaction.message.id,
        user: user.tag
      });
      
      // Process only clock emoji reactions for time conversion.
      if (reaction.emoji.name === CLOCK_EMOJI) {
        await handleClockReaction(reaction, user);
      }
    } catch (error) {
      // Catch-all for any unhandled errors in the event handler.
      logger.error("Error processing messageReactionAdd event:", { 
        error: error.message || error.toString(),
        stack: error.stack 
      });
    }
  }
};

/**
 * Fetches partial reaction and message data if needed
 * @param {MessageReaction} reaction - The reaction object
 */
async function fetchPartialData(reaction) {
  // Handle partial reactions by fetching the complete data.
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      logger.error("Failed to fetch partial reaction:", { error });
      throw error; // Re-throw to stop processing
    }
  }
  
  // Handle partial messages by fetching the complete data.
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      logger.error("Failed to fetch partial message:", { error });
      throw error; // Re-throw to stop processing
    }
  }
}

/**
 * Handles clock emoji reactions for time conversion
 * @param {MessageReaction} reaction - The reaction object
 * @param {User} user - The user who reacted
 */
async function handleClockReaction(reaction, user) {
  try {
    // Get the reactor's timezone from database.
    const userTimezone = await getUserTimezone(user.id);
    
    // Handle case where reactor has no timezone set.
    if (!userTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ <@${user.id}>, you haven't set your timezone yet. Please use the \`/timezone\` command to set your timezone.`
      );
      return;
    }
    
    // Get the message author's timezone from database.
    const messageAuthorId = reaction.message.author.id;
    const messageAuthorTimezone = await getUserTimezone(messageAuthorId);
    
    // Handle case where message author has no timezone set.
    if (!messageAuthorTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ <@${user.id}>, the author of that message hasn't set their timezone yet, so I can't convert the time accurately.`
      );
      return;
    }
    
    // Get time references and process them
    const timeReferences = await getTimeReferences(reaction.message);
    
    if (timeReferences && timeReferences.length > 0) {
      await processTimeConversion(
        reaction.message.channel,
        user.id,
        timeReferences,
        messageAuthorTimezone,
        userTimezone
      );
    } else {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ <@${user.id}>, I couldn't find any time references in that message. *This message will self-destruct in 15 seconds.*`
      );
    }
  } catch (error) {
    logger.error("Error handling clock reaction:", { error });
  }
}

/**
 * Gets time references from a message, either from cache or by extracting them
 * @param {Message} message - The Discord message
 * @returns {Array} Array of time references
 */
async function getTimeReferences(message) {
  // Check for cached time references
  let timeReferences = global.timeReferenceCache?.get(message.id);
  
  // If not in cache and message has content, extract them
  if (!timeReferences && message.content) {
    timeReferences = extractTimeReferences(message.content);
    
    // Cache the extracted time references if found
    if (timeReferences.length > 0) {
      if (!global.timeReferenceCache) {
        global.timeReferenceCache = new Map();
      }
      global.timeReferenceCache.set(message.id, timeReferences);
      
      logger.debug("Re-extracted time references for message:", {
        messageId: message.id,
        references: timeReferences.map(ref => ref.text)
      });
    }
  }
  
  return timeReferences;
}

/**
 * Processes time conversion between two timezones
 * @param {TextChannel} channel - The Discord channel to send the message to
 * @param {string} userId - The user ID who requested the conversion
 * @param {Array} timeReferences - Array of time references
 * @param {string} fromTimezone - Source timezone
 * @param {string} toTimezone - Target timezone
 */
async function processTimeConversion(channel, userId, timeReferences, fromTimezone, toTimezone) {
  try {
    logger.info("Processing time conversion:", {
      fromTimezone,
      toTimezone,
      references: timeReferences.map(ref => ref.text)
    });
    
    // Convert each time reference between the two timezones
    const convertedTimes = timeReferences.map(ref => {
      return convertTimeZones(ref, fromTimezone, toTimezone);
    });
    
    // Format the converted times into a readable message
    const formattedTimes = formatConvertedTimes(convertedTimes);
    const messageContent = `${CLOCK_EMOJI} <@${userId}>, here are the time conversions:\n\n${formattedTimes}\n\n*This message will self-destruct in 30 seconds.*`;
    
    await sendTemporaryMessage(channel, messageContent);
  } catch (error) {
    logger.error("Failed to process time conversion:", { error });
  }
}

/**
 * Sends a temporary message that deletes itself after a timeout
 * @param {TextChannel} channel - The Discord channel to send to
 * @param {string} content - The message content
 * @param {number} timeout - Time in ms before deletion (defaults to TIME_CONVERSION_TIMEOUT)
 */
async function sendTemporaryMessage(channel, content, timeout = TIME_CONVERSION_TIMEOUT) {
  try {
    const reply = await channel.send(content);
    
    setTimeout(() => {
      reply.delete().catch(err => 
        logger.error("Failed to delete temporary message:", { 
          error: err.message || err.toString() 
        })
      );
    }, timeout);
    
    return reply;
  } catch (error) {
    logger.error("Failed to send temporary message:", { 
      error: error.message || error.toString(),
      channelId: channel.id
    });
    return null;
  }
}