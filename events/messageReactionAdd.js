const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone } = require('../utils/database');
const { extractTimeReferences, convertTimeZones, formatConvertedTimes } = require('../utils/timeUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const Sentry = require('../sentry');

// We define configuration constants for consistent time conversion behavior.
const CLOCK_EMOJI = '🕒';
const TIME_CONVERSION_TIMEOUT = 30000; // We set a 30-second timeout for temporary messages.

// We extend dayjs with timezone capabilities for accurate time conversions.
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * We handle reactions being added to messages.
 * This function manages reaction-based interactions and time conversions.
 *
 * We perform several tasks for each reaction:
 * 1. We process role assignments based on reaction emojis.
 * 2. We handle time conversion requests via clock reactions.
 * 3. We track reaction statistics for monitoring.
 *
 * @param {MessageReaction} reaction - The reaction that was added.
 * @param {User} user - The user who added the reaction.
 */
module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    try {
      // We ignore reactions from bots to prevent infinite loops.
      if (user.bot) return;

      // We handle partial reactions by fetching their complete data.
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          logger.error('Error fetching partial reaction:', {
            error: error.message,
            stack: error.stack
          });
          return;
        }
      }

      // We handle clock reactions for time conversion requests.
      if (reaction.emoji.name === CLOCK_EMOJI) {
        await handleClockReaction(reaction, user);
        return;
      }

      // We process role assignments based on reaction emojis.
      if (reaction.message.guild) {
        const member = reaction.message.guild.members.cache.get(user.id);
        if (member) {
          // We handle role assignments here.
          // Example: if (reaction.emoji.name === '✅') { await member.roles.add(roleId); }
        }
      }

      logger.debug(`Processed reaction ${reaction.emoji.name} from ${user.tag}`);
    } catch (error) {
      logger.error(`Error processing reaction from ${user.tag}:`, {
        error: error.message,
        stack: error.stack
      });
    }
  }
};

/**
 * We fetch partial reaction and message data to ensure complete information.
 * This function handles data fetching for partial Discord objects.
 * 
 * @param {MessageReaction} reaction - The reaction object to fetch data for.
 */
async function fetchPartialData(reaction) {
  // We handle partial reactions by fetching their complete data.
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
  
  // We handle partial messages by fetching their complete data.
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
 * We handle clock emoji reactions for time conversion requests.
 * This function processes timezone conversions for users.
 * 
 * @param {MessageReaction} reaction - The reaction object.
 * @param {User} user - The user who reacted.
 */
async function handleClockReaction(reaction, user) {
  try {
    // We get the reactor's timezone from the database for conversion.
    const userTimezone = await getUserTimezone(user.id);
    
    // We handle cases where the reactor hasn't set their timezone.
    if (!userTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ <@${user.id}>, you haven't set your timezone yet. Please use the \`/timezone\` command to set your timezone.`
      );
      return;
    }
    
    // We get the message author's timezone for source time conversion.
    const messageAuthorId = reaction.message.author.id;
    const messageAuthorTimezone = await getUserTimezone(messageAuthorId);
    
    // We handle cases where the message author hasn't set their timezone.
    if (!messageAuthorTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ <@${user.id}>, the author of that message hasn't set their timezone yet, so I can't convert the time accurately.`
      );
      return;
    }
    
    // We extract and process time references from the message.
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
        `⚠️ <@${user.id}>, I couldn't find any time references in that message.`
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
 * We get time references from a message, using cache when available.
 * This function optimizes performance by caching extracted time references.
 * 
 * @param {Message} message - The Discord message to process.
 * @returns {Array} Array of time references found in the message.
 */
async function getTimeReferences(message) {
  // We check the cache first for existing time references.
  let timeReferences = global.timeReferenceCache?.get(message.id);
  
  // We extract time references if not found in cache.
  if (!timeReferences && message.content) {
    timeReferences = extractTimeReferences(message.content);
    
    // We cache the extracted references for future use.
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
 * We process time conversion between two timezones.
 * This function handles the conversion and formatting of time references.
 * 
 * @param {TextChannel} channel - The channel to send the conversion result to.
 * @param {string} userId - The ID of the user requesting the conversion.
 * @param {Array} timeReferences - Array of time references to convert.
 * @param {string} fromTimezone - The source timezone.
 * @param {string} toTimezone - The target timezone.
 */
async function processTimeConversion(channel, userId, timeReferences, fromTimezone, toTimezone) {
  try {
    logger.info("Processing time conversion:", {
      fromTimezone,
      toTimezone,
      references: timeReferences.map(ref => ref.text)
    });
    
    // We convert each time reference to the target timezone.
    const convertedTimes = timeReferences.map(ref => {
      return convertTimeZones(ref, fromTimezone, toTimezone);
    });
    
    // We format the converted times into a readable message.
    const formattedTimes = formatConvertedTimes(convertedTimes);
    const messageContent = `${CLOCK_EMOJI} <@${userId}>, ${formattedTimes}`;
    
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
 * We send temporary messages that auto-delete after a timeout.
 * This function helps keep channels clean while providing information.
 * 
 * @param {TextChannel} channel - The channel to send the message to.
 * @param {string} content - The content of the message.
 * @param {number} timeout - Time in milliseconds before deletion.
 * @returns {Promise<Message|null>} The sent message or null if failed.
 */
async function sendTemporaryMessage(channel, content, timeout = TIME_CONVERSION_TIMEOUT) {
  try {
    const reply = await channel.send(content);
    
    setTimeout(() => {
      reply.delete().catch(error => {
        Sentry.captureException(error, {
          extra: {
            event: 'deleteTemporaryMessage',
            channelId: channel.id,
            messageId: reply.id
          }
        });
        logger.error("Failed to delete temporary message:", { 
          error: error.message || error.toString() 
        });
      });
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