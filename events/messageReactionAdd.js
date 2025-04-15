const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone } = require('../utils/database');
const { extractTimeReferences, convertTimeZones, formatConvertedTimes } = require('../utils/timeUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const Sentry = require('../sentry');

// We use these configuration constants for consistent time conversion behavior.
const CLOCK_EMOJI = '🕒';
const TIME_CONVERSION_TIMEOUT = 15000; // We set a 15-second timeout for temporary messages.

// We extend dayjs with timezone capabilities for accurate time conversions.
dayjs.extend(utc);
dayjs.extend(timezone);

module.exports = {
  name: 'messageReactionAdd',
  
  /**
   * Handles the messageReactionAdd event for time conversion functionality.
   * We process reactions to messages with time references to provide timezone conversions.
   * 
   * @param {MessageReaction} reaction - The Discord.js MessageReaction object.
   * @param {User} user - The Discord.js User who added the reaction.
   * @returns {Promise<void>}
   */
  async execute(reaction, user) {
    try {
      // We ignore reactions from bots to prevent potential loops or unnecessary processing.
      if (user.bot) return;
      
      // We handle partial reactions and messages by fetching their complete data.
      await fetchPartialData(reaction);
      
      logger.debug("Reaction added:", {
        emoji: reaction.emoji.name,
        messageId: reaction.message.id,
        user: user.tag
      });
      
      // We process only clock emoji reactions for time conversion functionality.
      if (reaction.emoji.name === CLOCK_EMOJI) {
        await handleClockReaction(reaction, user);
      }
    } catch (error) {
      // Add Sentry error tracking
      Sentry.captureException(error, {
        extra: {
          event: 'messageReactionAdd',
          reactionEmoji: reaction.emoji?.name || 'unknown',
          messageId: reaction.message?.id || 'unknown',
          userId: user.id
        }
      });
      logger.error("Error processing messageReactionAdd event:", { 
        error: error.message || error.toString(),
        stack: error.stack 
      });
    }
}
};

/**
 * Fetches partial reaction and message data if needed.
 * We ensure we have complete data before processing reactions.
 * 
 * @param {MessageReaction} reaction - The reaction object.
 */
async function fetchPartialData(reaction) {
  // We handle partial reactions by fetching the complete data.
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          event: 'fetchPartialReaction',
          reactionEmoji: reaction.emoji?.name || 'unknown',
          messageId: reaction.message?.id || 'unknown',
          userId: reaction.user?.id || 'unknown'
        }
      });
      logger.error("Failed to fetch partial reaction:", { error });
      throw error; // We re-throw to stop processing since we need complete data.
    }
  }
  
  // We handle partial messages by fetching the complete data.
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          event: 'fetchPartialMessage',
          messageId: reaction.message?.id || 'unknown',
          userId: reaction.user?.id || 'unknown'
        }
      });
      logger.error("Failed to fetch partial message:", { error });
      throw error; // We re-throw to stop processing since we need complete data.
    }
  }
}

/**
 * Handles clock emoji reactions for time conversion.
 * We process the request and provide timezone conversions when appropriate.
 * 
 * @param {MessageReaction} reaction - The reaction object.
 * @param {User} user - The user who reacted.
 */
async function handleClockReaction(reaction, user) {
  try {
    // We get the reactor's timezone from database to know their local time.
    const userTimezone = await getUserTimezone(user.id);
    
    // We handle the case where the reactor has no timezone set.
    if (!userTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ <@${user.id}>, you haven't set your timezone yet. Please use the \`/timezone\` command to set your timezone.`
      );
      return;
    }
    
    // We get the message author's timezone from database as the source timezone.
    const messageAuthorId = reaction.message.author.id;
    const messageAuthorTimezone = await getUserTimezone(messageAuthorId);
    
    // We handle the case where the message author has no timezone set.
    if (!messageAuthorTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ <@${user.id}>, the author of that message hasn't set their timezone yet, so I can't convert the time accurately.`
      );
      return;
    }
    
    // We get time references from the message and process them for conversion.
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
    Sentry.captureException(error, {
      extra: {
        event: 'handleClockReaction',
        reactionEmoji: reaction.emoji?.name || 'unknown',
        messageId: reaction.message?.id || 'unknown',
        userId: user.id
      }
    });
    logger.error("Error handling clock reaction:", { error });
  }
}

/**
 * Gets time references from a message, either from cache or by extracting them.
 * We optimize performance by using cached values when available.
 * 
 * @param {Message} message - The Discord message.
 * @returns {Array} Array of time references.
 */
async function getTimeReferences(message) {
  // We check for cached time references to avoid repeated processing.
  let timeReferences = global.timeReferenceCache?.get(message.id);
  
  // We extract time references if they're not in the cache and the message has content.
  if (!timeReferences && message.content) {
    timeReferences = extractTimeReferences(message.content);
    
    // We cache the extracted time references if found for future use.
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
 * Processes time conversion between two timezones.
 * We convert time references from the source timezone to the target timezone.
 * 
 * @param {TextChannel} channel - The Discord channel to send the message to.
 * @param {string} userId - The user ID who requested the conversion.
 * @param {Array} timeReferences - Array of time references.
 * @param {string} fromTimezone - Source timezone.
 * @param {string} toTimezone - Target timezone.
 */
async function processTimeConversion(channel, userId, timeReferences, fromTimezone, toTimezone) {
  try {
    logger.info("Processing time conversion:", {
      fromTimezone,
      toTimezone,
      references: timeReferences.map(ref => ref.text)
    });
    
    // We convert each time reference between the two timezones for accurate local times.
    const convertedTimes = timeReferences.map(ref => {
      return convertTimeZones(ref, fromTimezone, toTimezone);
    });
    
    // We format the converted times into a readable message for the user.
    const formattedTimes = formatConvertedTimes(convertedTimes);
    const messageContent = `${CLOCK_EMOJI} <@${userId}>, ${formattedTimes}\n\n*This message will self-destruct in 15 seconds.*`;
    
    await sendTemporaryMessage(channel, messageContent, 15000);
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        event: 'processTimeConversion',
        fromTimezone,
        toTimezone,
        timeReferences: timeReferences.map(ref => ref.text)
      }
    });
    logger.error("Failed to process time conversion:", { error });
  }
}

/**
 * Sends a temporary message that deletes itself after a timeout.
 * We use this to keep channels clean while still providing useful information.
 * 
 * @param {TextChannel} channel - The Discord channel to send to.
 * @param {string} content - The message content.
 * @param {number} timeout - Time in ms before deletion (defaults to TIME_CONVERSION_TIMEOUT).
 */
async function sendTemporaryMessage(channel, content, timeout = TIME_CONVERSION_TIMEOUT) {
  try {
    const reply = await channel.send(content);
    
    setTimeout(() => {
      reply.delete().catch(err => 
        Sentry.captureException(err, {
          extra: {
            event: 'deleteTemporaryMessage',
            channelId: channel.id,
            messageId: reply.id
          }
        }),
        logger.error("Failed to delete temporary message:", { 
          error: err.message || err.toString() 
        })
      );
    }, timeout);
    
    return reply;
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        event: 'sendTemporaryMessage',
        channelId: channel.id,
        content
      }
    });
    logger.error("Failed to send temporary message:", { 
      error: error.message || error.toString(),
      channelId: channel.id
    });
    return null;
  }
}