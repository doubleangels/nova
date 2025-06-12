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
const { Events } = require('discord.js');
const axios = require('axios');
const config = require('../config');

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
          logger.error('Error fetching reaction:', {
            error: error.stack,
            message: error.message,
            userId: user.id,
            messageId: reaction.message.id
          });
          throw new Error("⚠️ Failed to fetch reaction data.");
        }
      }

      logger.info(`Processing reaction ${reaction.emoji.name} from user ${user.tag}`);

      if (reaction.emoji.name === '🕒') {
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
      logger.error('Error processing reaction:', {
        error: error.stack,
        message: error.message,
        emoji: reaction.emoji.name,
        userId: user.id,
        messageId: reaction.message.id
      });

      let errorMessage = "⚠️ An unexpected error occurred while processing the reaction.";
      
      if (error.message === "⚠️ Failed to fetch reaction data.") {
        errorMessage = "⚠️ Failed to fetch reaction data.";
      } else if (error.message === "⚠️ Invalid timezone for time conversion.") {
        errorMessage = "⚠️ Invalid timezone for time conversion.";
      } else if (error.message === "⚠️ No time references found in the message.") {
        errorMessage = "⚠️ No time references found in the message.";
      } else if (error.message === "⚠️ Invalid translation flag provided.") {
        errorMessage = "⚠️ Invalid translation flag provided.";
      } else if (error.message === "⚠️ No text to translate found in the message.") {
        errorMessage = "⚠️ No text to translate found in the message.";
      } else if (error.message === "⚠️ Translation API error occurred.") {
        errorMessage = "⚠️ Translation API error occurred.";
      } else if (error.message === "⚠️ Failed to translate the message.") {
        errorMessage = "⚠️ Failed to translate the message.";
      } else if (error.message === "⚠️ Message not found for translation.") {
        errorMessage = "⚠️ Message not found for translation.";
      } else if (error.message === "⚠️ Insufficient permissions to process reaction.") {
        errorMessage = "⚠️ Insufficient permissions to process reaction.";
      } else if (error.message === "⚠️ Invalid reaction data received.") {
        errorMessage = "⚠️ Invalid reaction data received.";
      } else if (error.message === "⚠️ Failed to send temporary message.") {
        errorMessage = "⚠️ Failed to send temporary message.";
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
      logger.error('Failed to fetch partial reaction:', {
        error: error.stack,
        message: error.message,
        emoji: reaction.emoji?.name || 'unknown',
        messageId: reaction.message?.id || 'unknown',
        userId: reaction.user?.id || 'unknown'
      });
      throw error;
    }
  }
  
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      logger.error('Failed to fetch partial message:', {
        error: error.stack,
        message: error.message,
        messageId: reaction.message?.id || 'unknown',
        userId: reaction.user?.id || 'unknown'
      });
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
        `⚠️ Invalid timezone for time conversion.`
      );
      return;
    }
    
    const messageAuthorId = reaction.message.author.id;
    const messageAuthorTimezone = await getUserTimezone(messageAuthorId);
    
    if (!messageAuthorTimezone) {
      await sendTemporaryMessage(
        reaction.message.channel,
        `⚠️ Invalid timezone for time conversion.`
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
        `⚠️ No time references found in the message.`
      );
    }
  } catch (error) {
    logger.error('Error handling clock reaction:', {
      error: error.stack,
      message: error.message,
      emoji: reaction.emoji?.name || 'unknown',
      messageId: reaction.message?.id || 'unknown',
      userId: user.id
    });
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
      
      logger.debug('Re-extracted time references for message:', {
        messageId: message.id,
        references: timeReferences.map(ref => ref.text)
      });
    }
  }
  
  return timeReferences;
}

async function processTimeConversion(channel, userId, timeReferences, fromTimezone, toTimezone) {
  try {
    logger.info('Processing time conversion:', {
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
      title: `🕒 Time Conversion`,
      description: formattedTimes,
      footer: {
        text: `Requested by: ${member?.user.tag || userId}`
      },
      timestamp: new Date()
    };
    
    await sendTemporaryMessage(channel, { embeds: [embed] }, 15000);
  } catch (error) {
    logger.error('Failed to process time conversion:', {
      error: error.stack,
      message: error.message,
      fromTimezone,
      toTimezone,
      timeReferences: timeReferences.map(ref => ref.text)
    });
  }
}

async function sendTemporaryMessage(channel, content, timeout = 30000) {
  try {
    const reply = await channel.send(content);
    
    setTimeout(() => {
      reply.delete().catch(error => {
        logger.error('Failed to delete temporary message:', {
          error: error.stack,
          message: error.message,
          channelId: channel.id,
          messageId: reply.id
        });
      });
    }, timeout);
    
    return reply;
  } catch (error) {
    logger.error('Failed to send temporary message:', {
      error: error.stack,
      message: error.message,
      channelId: channel.id
    });
    return null;
  }
}

async function handleTranslationRequest(reaction, user) {
    try {
        logger.debug('Handling translation request:', {
            flagEmoji: reaction.emoji.name,
            userId: user.id,
            userTag: user.tag,
            messageId: reaction.message.id
        });

        const flagEmoji = reaction.emoji.name;
        const languageInfo = getLanguageInfo(flagEmoji);
        if (!languageInfo) {
            logger.warn('Invalid translation flag:', { flagEmoji });
            throw new Error("⚠️ Invalid translation flag provided.");
        }

        const message = reaction.message;
        if (!message) {
            logger.warn('Message not found for translation:', {
                messageId: reaction.message?.id,
                userId: user.id
            });
            throw new Error("⚠️ Message not found for translation.");
        }

        const originalText = message.content;
        if (!originalText) {
            logger.warn('Empty message content for translation:', {
                messageId: message.id,
                userId: user.id
            });
            throw new Error("⚠️ No text to translate found in the message.");
        }

        logger.debug('Making translation API request:', {
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
        logger.debug('Translation API response received:', {
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

        logger.debug('Sending translation response:', {
            targetLanguage: languageInfo.name,
            userId: user.id,
            messageId: message.id
        });

        await message.reply({ embeds: [embed] });
        
        logger.info('Translation completed successfully:', {
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
                ? "⚠️ Translation API error occurred."
                : "⚠️ Failed to translate the message.";
            
            logger.debug('Sending translation error response:', {
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
                error: replyError.stack,
                message: replyError.message,
                originalError: error.message
            });
        }
    }
}