/**
 * Event handler for when reactions are added to messages.
 * Handles reaction-based interactions and role assignments.
 * @module events/messageReactionAdd
 */

const path = require('path');
const logger = require('../logger')('messageReactionAdd.js');
const { getUserTimezone } = require('../utils/database');
const { extractTimeReferences, convertTimeZones, formatConvertedTimes } = require('../utils/timeUtils');
const { getLanguageInfo, isValidTranslationFlag } = require('../utils/languageUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const Sentry = require('../sentry');
const { logError, ERROR_MESSAGES } = require('../errors');
const { Events } = require('discord.js');
const axios = require('axios');
const config = require('../config');

const CLOCK_EMOJI = '🕒';
const TIME_CONVERSION_TIMEOUT = 30000;

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Event handler for message reaction events.
 * @type {Object}
 */
module.exports = {
  name: Events.MessageReactionAdd,
  /**
   * Executes when a reaction is added to a message.
   * @async
   * @function execute
   * @param {MessageReaction} reaction - The reaction that was added
   * @param {User} user - The user that added the reaction
   * @throws {Error} If reaction handling fails
   */
  async execute(reaction, user) {
    try {
      // Ignore reactions from bots
      if (user.bot) {
        logger.debug('Bot reaction received, ignoring');
        return;
      }

      // Handle partial reactions
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          logger.error('Error fetching reaction:', error);
          return;
        }
      }

      // Process reaction
      logger.info(`Processing reaction ${reaction.emoji.name} from user ${user.tag}`);

      if (reaction.emoji.name === CLOCK_EMOJI) {
        await handleClockReaction(reaction, user);
        return;
      }

      if (reaction.message.guild) {
        const member = reaction.message.guild.members.cache.get(user.id);
        if (member) {
        }
      }

      const flagEmoji = reaction.emoji.name;
      if (isValidTranslationFlag(flagEmoji)) {
        await handleTranslationRequest(reaction, user);
        return;
      }

      logger.info(`Successfully processed reaction from ${user.tag}`);
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          event: 'messageReactionAdd',
          emoji: reaction.emoji.name,
          userId: user.id,
          messageId: reaction.message.id
        }
      });
      logger.error(`Error processing reaction:`, {
        error: error.message,
        stack: error.stack
      });
      
      logError(error, 'messageReactionAdd', {
        emoji: reaction.emoji.name,
        userId: user.id,
        messageId: reaction.message.id
      });
      throw new Error(ERROR_MESSAGES.REACTION_HANDLING_FAILED);
    }
  }
};

async function fetchPartialData(reaction) {
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
      throw error;
    }
  }
  
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
      throw error;
    }
  }
}

async function handleClockReaction(reaction, user) {
  try {
    const userTimezone = await getUserTimezone(user.id);
    
    if (!userTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ ${ERROR_MESSAGES.TIME_CONVERSION_INVALID_TIMEZONE}`
      );
      return;
    }
    
    const messageAuthorId = reaction.message.author.id;
    const messageAuthorTimezone = await getUserTimezone(messageAuthorId);
    
    if (!messageAuthorTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ ${ERROR_MESSAGES.TIME_CONVERSION_INVALID_TIMEZONE}`
      );
      return;
    }
    
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
        `⚠️ ${ERROR_MESSAGES.TIME_MISSING_REFERENCE}`
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

async function getTimeReferences(message) {
  let timeReferences = global.timeReferenceCache?.get(message.id);
  
  if (!timeReferences && message.content) {
    timeReferences = extractTimeReferences(message.content);
    
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

async function processTimeConversion(channel, userId, timeReferences, fromTimezone, toTimezone) {
  try {
    logger.info("Processing time conversion:", {
      fromTimezone,
      toTimezone,
      references: timeReferences.map(ref => ref.text)
    });
    
    const convertedTimes = timeReferences.map(ref => {
      return convertTimeZones(ref, fromTimezone, toTimezone);
    });
    
    const formattedTimes = formatConvertedTimes(convertedTimes);

    let embedColor = 0x0099ff;
    const member = channel.guild?.members.cache.get(userId);
    if (member) {
      const highestRole = member.roles.highest;
      if (highestRole && highestRole.color !== 0) {
        embedColor = highestRole.color;
      }
    }

    const embed = {
      color: embedColor,
      title: `${CLOCK_EMOJI} Time Conversion`,
      description: formattedTimes,
      footer: {
        text: `Requested by: ${member?.user.tag || userId}`
      },
      timestamp: new Date()
    };
    
    await sendTemporaryMessage(channel, { embeds: [embed] }, 15000);
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

async function handleTranslationRequest(reaction, user) {
    try {
        const flagEmoji = reaction.emoji.name;
        const languageInfo = getLanguageInfo(flagEmoji);
        if (!languageInfo) {
            throw new Error(ERROR_MESSAGES.TRANSLATION_INVALID_FLAG);
        }

        const message = reaction.message;
        if (!message) {
            throw new Error(ERROR_MESSAGES.DISCORD_MESSAGE_NOT_FOUND);
        }
        const originalText = message.content;
        if (!originalText) {
            throw new Error(ERROR_MESSAGES.TRANSLATION_EMPTY_TEXT);
        }

        const response = await axios.post(
            `https://translation.googleapis.com/language/translate/v2?key=${config.googleApiKey}`,
            {
                q: originalText,
                target: languageInfo.code,
                format: 'text'
            }
        );

        const translatedText = response.data.data.translations[0].translatedText;

        let embedColor = 0x0099ff; // Default Discord blue
        if (message.guild) {
            const member = message.guild.members.cache.get(user.id);
            if (member) {
                const highestRole = member.roles.highest;
                if (highestRole && highestRole.color !== 0) {
                    embedColor = highestRole.color;
                }
            }
        }

        const embed = {
            color: embedColor,
            title: `Translation to ${languageInfo.name} ${flagEmoji}`,
            description: translatedText,
            footer: {
                text: `Translation requested by: ${user.tag}`
            },
            timestamp: new Date()
        };

        await message.reply({ embeds: [embed] });
    } catch (error) {
        const errorInfo = {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers ? Object.keys(error.config.headers) : undefined
            }
        };

        logger.error('Error in translation request:', errorInfo);
        
        try {
            const errorMessage = error.response?.status === 403 
                ? ERROR_MESSAGES.TRANSLATION_API_ERROR
                : ERROR_MESSAGES.TRANSLATION_FAILED;
            
            await reaction.message.reply({
                content: `⚠️ ${errorMessage}`,
                allowedMentions: { repliedUser: false }
            });
        } catch (replyError) {
            logger.error('Failed to send error message:', {
                message: replyError.message,
                code: replyError.code
            });
        }
    }
}