/**
 * Event handler for when reactions are added to messages.
 * Handles reaction-based interactions and role assignments.
 * @module events/messageReactionAdd
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone } = require('../utils/database');
const { extractTimeReferences, convertTimeZones, formatConvertedTimes } = require('../utils/timeUtils');
const { getLanguageInfo, isValidTranslationFlag } = require('../utils/languageUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const Sentry = require('../sentry');
const { logError } = require('../errors');
const { Events } = require('discord.js');
const axios = require('axios');
const config = require('../config');

const REACTION_CLOCK_EMOJI = '🕒';

const REACTION_TIME_CONVERSION_TIMEOUT = 30000;

const REACTION_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while processing the reaction.";
const REACTION_ERROR_HANDLING = "⚠️ Failed to process the reaction.";
const REACTION_ERROR_FETCH = "⚠️ Failed to fetch reaction data.";
const REACTION_ERROR_TIMEZONE = "⚠️ Invalid timezone for time conversion.";
const REACTION_ERROR_TIME_REFERENCE = "⚠️ No time references found in the message.";
const REACTION_ERROR_TRANSLATION_FLAG = "⚠️ Invalid translation flag provided.";
const REACTION_ERROR_TRANSLATION_EMPTY = "⚠️ No text to translate found in the message.";
const REACTION_ERROR_TRANSLATION_API = "⚠️ Translation API error occurred.";
const REACTION_ERROR_TRANSLATION = "⚠️ Failed to translate the message.";
const REACTION_ERROR_MESSAGE_NOT_FOUND = "⚠️ Message not found for translation.";
const REACTION_ERROR_PERMISSION = "⚠️ Insufficient permissions to process reaction.";
const REACTION_ERROR_INVALID = "⚠️ Invalid reaction data received.";
const REACTION_ERROR_TEMPORARY_MESSAGE = "⚠️ Failed to send temporary message.";

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
      if (user.bot) {
        logger.debug('Bot reaction received, ignoring.');
        return;
      }

      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          logger.error('Error fetching reaction:', error);
          throw new Error(REACTION_ERROR_FETCH);
        }
      }

      logger.info(`Processing reaction ${reaction.emoji.name} from user ${user.tag}.`);

      if (reaction.emoji.name === REACTION_CLOCK_EMOJI) {
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

      logger.info(`Successfully processed reaction from ${user.tag}.`);
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

      let errorMessage = REACTION_ERROR_UNEXPECTED;
      
      if (error.message === REACTION_ERROR_FETCH) {
        errorMessage = REACTION_ERROR_FETCH;
      } else if (error.message === REACTION_ERROR_TIMEZONE) {
        errorMessage = REACTION_ERROR_TIMEZONE;
      } else if (error.message === REACTION_ERROR_TIME_REFERENCE) {
        errorMessage = REACTION_ERROR_TIME_REFERENCE;
      } else if (error.message === REACTION_ERROR_TRANSLATION_FLAG) {
        errorMessage = REACTION_ERROR_TRANSLATION_FLAG;
      } else if (error.message === REACTION_ERROR_TRANSLATION_EMPTY) {
        errorMessage = REACTION_ERROR_TRANSLATION_EMPTY;
      } else if (error.message === REACTION_ERROR_TRANSLATION_API) {
        errorMessage = REACTION_ERROR_TRANSLATION_API;
      } else if (error.message === REACTION_ERROR_TRANSLATION) {
        errorMessage = REACTION_ERROR_TRANSLATION;
      } else if (error.message === REACTION_ERROR_MESSAGE_NOT_FOUND) {
        errorMessage = REACTION_ERROR_MESSAGE_NOT_FOUND;
      } else if (error.message === REACTION_ERROR_PERMISSION) {
        errorMessage = REACTION_ERROR_PERMISSION;
      } else if (error.message === REACTION_ERROR_INVALID) {
        errorMessage = REACTION_ERROR_INVALID;
      } else if (error.message === REACTION_ERROR_TEMPORARY_MESSAGE) {
        errorMessage = REACTION_ERROR_TEMPORARY_MESSAGE;
      }
      
      throw new Error(errorMessage);
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
        `⚠️ ${REACTION_ERROR_TIMEZONE}`
      );
      return;
    }
    
    const messageAuthorId = reaction.message.author.id;
    const messageAuthorTimezone = await getUserTimezone(messageAuthorId);
    
    if (!messageAuthorTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ ${REACTION_ERROR_TIMEZONE}`
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
        `⚠️ ${REACTION_ERROR_TIME_REFERENCE}`
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
      title: `${REACTION_CLOCK_EMOJI} Time Conversion`,
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

async function sendTemporaryMessage(channel, content, timeout = REACTION_TIME_CONVERSION_TIMEOUT) {
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
        logger.debug("Handling translation request:", {
            flagEmoji: reaction.emoji.name,
            userId: user.id,
            userTag: user.tag,
            messageId: reaction.message.id
        });

        const flagEmoji = reaction.emoji.name;
        const languageInfo = getLanguageInfo(flagEmoji);
        if (!languageInfo) {
            logger.warn("Invalid translation flag:", { flagEmoji });
            throw new Error(REACTION_ERROR_TRANSLATION_FLAG);
        }

        const message = reaction.message;
        if (!message) {
            logger.warn("Message not found for translation:", {
                messageId: reaction.message?.id,
                userId: user.id
            });
            throw new Error(REACTION_ERROR_MESSAGE_NOT_FOUND);
        }

        const originalText = message.content;
        if (!originalText) {
            logger.warn("Empty message content for translation:", {
                messageId: message.id,
                userId: user.id
            });
            throw new Error(REACTION_ERROR_TRANSLATION_EMPTY);
        }

        logger.debug("Making translation API request:", {
            targetLanguage: languageInfo.code,
            textLength: originalText.length,
            userId: user.id
        });

        const response = await axios.post(
            `https://translation.googleapis.com/language/translate/v2?key=${config.googleApiKey}`,
            {
                q: originalText,
                target: languageInfo.code,
                format: 'text'
            }
        );

        const translatedText = response.data.data.translations[0].translatedText;
        logger.debug("Translation API response received:", {
            targetLanguage: languageInfo.code,
            translatedLength: translatedText.length,
            userId: user.id
        });

        let embedColor = 0x0099ff;
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

        logger.debug("Sending translation response:", {
            targetLanguage: languageInfo.name,
            userId: user.id,
            messageId: message.id
        });

        await message.reply({ embeds: [embed] });
        
        logger.info("Translation completed successfully:", {
            targetLanguage: languageInfo.name,
            userId: user.id,
            messageId: message.id
        });
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
                ? REACTION_ERROR_TRANSLATION_API
                : REACTION_ERROR_TRANSLATION;
            
            logger.debug("Sending translation error response:", {
                errorType: error.response?.status === 403 ? 'API_ERROR' : 'GENERAL_ERROR',
                userId: user.id,
                messageId: reaction.message?.id
            });

            await reaction.message.reply({
                content: `⚠️ ${errorMessage}`,
                allowedMentions: { repliedUser: false }
            });
        } catch (replyError) {
            logger.error('Failed to send error message:', {
                message: replyError.message,
                code: replyError.code,
                originalError: error.message
            });
        }
    }
}