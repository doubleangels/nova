const path = require('path');
const dayjs = require('dayjs');
const logger = require('../logger')(path.basename(__filename));
const { captureError } = require('../instrument');
const { getLanguageInfo, isValidTranslationFlag } = require('../utils/languageUtils');
const { Events } = require('discord.js');
const axios = require('axios');
const config = require('../config');

const DEEPL_FREE_TRANSLATE_URL = 'https://api-free.deepl.com/v2/translate';

const DEEPL_SUPPORTED_TARGET_LANGS = new Set([
  'BG', 'CS', 'DA', 'DE', 'EL', 'EN', 'EN-GB', 'EN-US', 'ES', 'ET', 'FI', 'FR',
  'HU', 'ID', 'IT', 'JA', 'KO', 'LT', 'LV', 'NB', 'NL', 'PL', 'PT', 'PT-BR',
  'PT-PT', 'RO', 'RU', 'SK', 'SL', 'SV', 'TR', 'UK', 'ZH', 'ZH-HANS', 'ZH-HANT'
]);

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

      logger.info('Processing reaction from user.', {
        emoji: reaction.emoji.name,
        userTag: user.tag
      });

      const flagEmoji = reaction.emoji.name;
      if (isValidTranslationFlag(flagEmoji)) {
        await handleTranslationRequest(reaction, user);
        return;
      }

      logger.info('Successfully processed reaction from user.', {
        userTag: user.tag
      });
    } catch (error) {
      // Do not rethrow — event handlers have no caller to receive the error.
      // Rethrowing here causes an unhandled promise rejection.
      logger.error('Error processing reaction', {
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
      messageId: reaction.message.id
    });

    const flagEmoji = reaction.emoji.name;
    const languageInfo = getLanguageInfo(flagEmoji);
    if (!languageInfo) {
      logger.warn('Invalid translation flag provided.', { flagEmoji });
      throw new Error("⚠️ Invalid translation flag provided.");
    }

    const message = reaction.message;
    if (!message) {
      logger.warn('Message not found for translation.', {
        messageId: reaction.message?.id,
        userId: user.id
      });
      throw new Error("⚠️ Message not found for translation.");
    }

    const originalText = message.content;
    if (!originalText) {
      logger.warn('Empty message content found for translation.', {
        messageId: message.id,
        userId: user.id
      });
      throw new Error("⚠️ No text to translate found in the message.");
    }

    if (!config.deeplApiKey) {
      logger.warn('DeepL API key missing; translation unavailable.', {
        userId: user.id,
        messageId: message.id
      });
      throw new Error('⚠️ DeepL is not configured yet.');
    }

    const targetLanguage = toDeepLTargetLanguage(languageInfo.code);
    if (!targetLanguage) {
      logger.warn('Selected language is unsupported by DeepL.', {
        flagEmoji,
        languageCode: languageInfo.code,
        languageName: languageInfo.name
      });
      throw new Error(`⚠️ ${languageInfo.name} is not supported by DeepL yet.`);
    }

    logger.debug('Making translation API request.', {
      targetLanguage,
      textLength: originalText.length,
      userId: user.id
    });

    const body = new URLSearchParams({
      text: originalText,
      target_lang: targetLanguage
    });
    const response = await axios.post(
      DEEPL_FREE_TRANSLATE_URL,
      body.toString(),
      {
        headers: {
          Authorization: `DeepL-Auth-Key ${config.deeplApiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const translatedText = response.data?.translations?.[0]?.text;
    if (!translatedText) {
      throw new Error('⚠️ DeepL returned an empty translation.');
    }
    logger.debug('Translation API response received successfully.', {
      targetLanguage,
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
      timestamp: dayjs().toDate()
    };

    logger.debug('Sending translation response to user.', {
      targetLanguage: languageInfo.name,
      userId: user.id,
      messageId: message.id
    });

    await message.reply({ embeds: [embed] });

    logger.info('Translation completed successfully.', {
      targetLanguage: languageInfo.name,
      userId: user.id,
      messageId: message.id
    });
  } catch (error) {
    captureError(error, { event: 'messageReactionAdd' });
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
        ? "⚠️ DeepL API error occurred."
        : "⚠️ Failed to translate the message.";

      logger.debug('Sending translation error response to user.', {
        errorType: error.response?.status === 403 ? 'API_ERROR' : 'GENERAL_ERROR',
        userId: user.id,
        messageId: reaction.message?.id
      });

      await reaction.message.reply({
        content: errorMessage,
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

function toDeepLTargetLanguage(languageCode) {
  if (!languageCode || typeof languageCode !== 'string') {
    return null;
  }

  const normalized = languageCode.trim().toUpperCase();
  const aliasMap = {
    NO: 'NB',
    ZH: 'ZH',
    PT: 'PT',
    EN: 'EN'
  };
  const deeplCode = aliasMap[normalized] || normalized;

  return DEEPL_SUPPORTED_TARGET_LANGS.has(deeplCode) ? deeplCode : null;
}