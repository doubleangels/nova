const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getLanguageInfo, isValidTranslationFlag } = require('../utils/languageUtils');
const { Events } = require('discord.js');
const axios = require('axios');
const config = require('../config');

module.exports = {
  name: Events.MessageReactionAdd,

  /**
   * Handles the event when a new reaction is added to a message.
   * This function:
   * 1. Handles translation requests via flag emojis
   * 2. Manages partial message/reaction fetching
   * 
   * @param {MessageReaction} reaction - The reaction that was added
   * @param {User} user - The user who added the reaction
   * @throws {Error} If there's an error processing the reaction
   * @returns {Promise<void>}
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
          logger.error('Error fetching reaction', {
            err: error,
            userId: user.id,
            messageId: reaction.message.id
          });
          throw new Error("⚠️ Failed to fetch reaction data.");
        }
      }

      logger.info(`Processing reaction ${reaction.emoji.name} from user ${user.tag}.`);

      const flagEmoji = reaction.emoji.name;
      if (isValidTranslationFlag(flagEmoji)) {
        await handleTranslationRequest(reaction, user);
        return;
      }

      logger.info(`Successfully processed reaction from ${user.tag}.`);
    } catch (error) {
      logger.error('Error processing reaction', {
        err: error,
        emoji: reaction.emoji.name,
        userId: user.id,
        messageId: reaction.message.id
      });

      let errorMessage = "⚠️ An unexpected error occurred while processing the reaction.";
      
      if (error.message === "⚠️ Failed to fetch reaction data.") {
        errorMessage = "⚠️ Failed to fetch reaction data.";
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



/**
 * Handles translation requests via flag emoji reactions
 * @param {MessageReaction} reaction - The flag emoji reaction
 * @param {User} user - The user who added the reaction
 * @returns {Promise<void>}
 */
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

        // Cache member lookup (already checked at line 45-48, but that was removed)
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
        logger.error('Error in translation request', {
            err: error,
            status: error.response?.status,
            statusText: error.response?.statusText,
            responseData: error.response?.data,
            requestUrl: error.config?.url,
            requestMethod: error.config?.method
        });
        
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
            logger.error('Failed to send error message', {
                err: replyError,
                originalError: error.message
            });
        }
    }
}