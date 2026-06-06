const path = require('path');
const dayjs = require('dayjs');
const logger = require('../logger')(path.basename(__filename));
const { captureError } = require('../instrument');
const { getLanguageInfo, isValidTranslationFlag } = require('../utils/languageUtils');
const { Events } = require('discord.js');
const httpClient = require('../utils/httpClient');
const { getCached, setCached, cacheKey } = require('../utils/responseCache');
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

      const emojiName = reaction.emoji.name;
      if (!isValidTranslationFlag(emojiName)) {
        return;
      }

      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          logger.error('Error occurred while fetching reaction.', {
            err: error,
            userId: user.id,
            messageId: reaction.message.id
          });
          captureError(error, { event: 'messageReactionAdd', handler: 'partialFetch' });
          return;
        }
      }

      logger.debug('Processing reaction from user.', {
        emoji: reaction.emoji.name,
        userTag: user.tag
      });

      await handleTranslationRequest(reaction, user);
    } catch (error) {
      captureError(error, { event: 'messageReactionAdd' });
      logger.error('Error occurred while processing reaction.', {
        err: error,
        emoji: reaction.emoji?.name,
        userId: user.id,
        messageId: reaction.message?.id
      });
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
    logger.debug('Handling translation request.', {
      flagEmoji: reaction.emoji.name,
      userId: user.id,
      userTag: user.tag,
      messageId: reaction.message?.id
    });

    if (!config.deeplApiKey) {
      logger.debug('Translation was skipped because DEEPL_API_KEY is not configured.');
      return;
    }

    const flagEmoji = reaction.emoji.name;
    const languageInfo = getLanguageInfo(flagEmoji);
    if (!languageInfo) {
      logger.warn('Invalid translation flag provided.', { flagEmoji });
      return;
    }

    const messageId = reaction.message?.id;
    let message = reaction.message;
    if (!message) {
      logger.warn('Message not found for translation.', {
        messageId,
        userId: user.id
      });
      return;
    }

    if (message.partial) {
      message = await message.fetch();
    }

    const originalText = message.content;
    if (!originalText) {
      logger.warn('Empty message content found for translation.', {
        messageId: message.id,
        userId: user.id
      });
      return;
    }

    const translationCacheKey = cacheKey('translation', message.id, languageInfo.code);
    let translatedText = getCached(translationCacheKey);

    if (!translatedText) {
      logger.debug('Making translation API request.', {
        targetLanguage: languageInfo.code,
        textLength: originalText.length,
        userId: user.id
      });

      const response = await httpClient.post(
        'https://api-free.deepl.com/v2/translate',
        new URLSearchParams({
          text: originalText,
          target_lang: languageInfo.code.toUpperCase()
        }),
        {
          timeout: 10000,
          headers: {
            Authorization: `DeepL-Auth-Key ${config.deeplApiKey}`
          }
        }
      );

      translatedText = response.data?.translations?.[0]?.text;
      if (!translatedText) {
        logger.warn('DeepL returned no translation.', {
          messageId: message.id,
          userId: user.id
        });
        return;
      }
      setCached(translationCacheKey, translatedText, 3600000);
    }

    logger.debug('Translation ready.', {
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
      timestamp: dayjs().toDate()
    };

    await message.reply({ embeds: [embed] });

    logger.info('Translation completed successfully.', {
      targetLanguage: languageInfo.name,
      userId: user.id,
      messageId: message.id
    });
  } catch (error) {
    captureError(error, { event: 'messageReactionAdd' });
    logger.error('Error occurred in translation request.', {
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

      if (reaction.message) {
        await reaction.message.reply({
          content: errorMessage,
          allowedMentions: { repliedUser: false }
        });
      }
    } catch (replyError) {
      logger.error('Failed to send error message.', {
        err: replyError,
        originalError: error.message
      });
    }
  }
}
