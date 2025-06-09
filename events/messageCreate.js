/**
 * Event handler for new messages in Discord channels.
 * Handles message processing, command parsing, and bot responses.
 * @module events/messageCreate
 */

const path = require('path');
const logger = require('../logger')('messageCreate.js');
const { getTrackedMember, removeTrackedMember, incrementMessageCount, incrementChannelMessageCount } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { extractTimeReferences } = require('../utils/timeUtils');
const Sentry = require('../sentry');
const { logError } = require('../errors');

/**
 * Error messages specific to the message create event.
 * @type {Object}
 */
const ERROR_MESSAGES = {
    UNEXPECTED_ERROR: "⚠️ An unexpected error occurred while processing the message.",
    MESSAGE_PROCESSING_FAILED: "⚠️ Failed to process the message.",
    FETCH_FAILED: "⚠️ Failed to fetch message content.",
    TRACKING_FAILED: "⚠️ Failed to track message data.",
    TIME_REFERENCE_FAILED: "⚠️ Failed to process time references.",
    BUMP_PROCESSING_FAILED: "⚠️ Failed to process bump message.",
    DATABASE_ERROR: "⚠️ Database error occurred while processing message.",
    PERMISSION_DENIED: "⚠️ Insufficient permissions to process message.",
    INVALID_MESSAGE: "⚠️ Invalid message data received.",
    REMINDER_FAILED: "⚠️ Failed to set reminder for bump message."
};

/**
 * Event handler for message creation events.
 * @type {Object}
 */
module.exports = {
  name: 'messageCreate',
  /**
   * Executes when a new message is created.
   * @async
   * @function execute
   * @param {Message} message - The message that was created
   * @throws {Error} If message processing fails
   */
  async execute(message) {
    try {
      if (message.partial) {
        try {
          await message.fetch();
        } catch (fetchError) {
          logger.error("Failed to fetch partial message:", { error: fetchError });
          throw new Error(ERROR_MESSAGES.FETCH_FAILED);
        }
      }

      if (message.author.bot) {
        logger.debug("Received bot message:", {
          botName: message.author.tag,
          content: message.content?.substring(0, 100),
          hasEmbeds: !!message.embeds,
          embedCount: message.embeds?.length
        });
      }

      if (message.author.bot && !message.author.tag.toLowerCase().includes('disboard') && !message.author.tag.toLowerCase().includes('nova')) return;

      logger.debug("Message received:", {
        author: message.author?.tag || "Unknown Author",
        channelId: message.channel.id,
        content: message.content?.substring(0, 50) || "No Content"
      });
      
      if (!message.author.bot) {
        await incrementMessageCount(message.author.id, message.author.username);
        logger.debug(`Incremented message count for user ${message.author.tag}.`);
      }

      const wasTracked = await removeTrackedMember(message.author.id);
      if (wasTracked) {
        logger.info(`User ${message.author.tag} sent their first message and was removed from mute tracking.`);
      }

      if (message.content.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        switch (command) {
          case 'ping':
            await message.reply('Pong!');
            break;
        }
      }

      await processUserMessage(message);
      await checkForBumpMessages(message);
      if (message.channel && message.channel.type === 0 && !message.author.bot) {
        await incrementChannelMessageCount(message.channel.id, message.channel.name);
      }
      logger.debug(`Processed message from ${message.author.tag} in ${message.channel.name}.`);
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          event: 'messageCreate',
          messageId: message.id,
          authorId: message.author?.id || 'unknown'
        }
      });
      logger.error("Error processing messageCreate event:", { error });
      
      logError(error, 'messageCreate', {
        messageId: message.id,
        authorId: message.author?.id,
        channelId: message.channel?.id,
        guildId: message.guild?.id
      });

      let errorMessage = ERROR_MESSAGES.UNEXPECTED_ERROR;
      
      if (error.message === "FETCH_FAILED") {
        errorMessage = ERROR_MESSAGES.FETCH_FAILED;
      } else if (error.message === "TRACKING_FAILED") {
        errorMessage = ERROR_MESSAGES.TRACKING_FAILED;
      } else if (error.message === "TIME_REFERENCE_FAILED") {
        errorMessage = ERROR_MESSAGES.TIME_REFERENCE_FAILED;
      } else if (error.message === "BUMP_PROCESSING_FAILED") {
        errorMessage = ERROR_MESSAGES.BUMP_PROCESSING_FAILED;
      } else if (error.message === "DATABASE_ERROR") {
        errorMessage = ERROR_MESSAGES.DATABASE_ERROR;
      } else if (error.message === "PERMISSION_DENIED") {
        errorMessage = ERROR_MESSAGES.PERMISSION_DENIED;
      } else if (error.message === "INVALID_MESSAGE") {
        errorMessage = ERROR_MESSAGES.INVALID_MESSAGE;
      } else if (error.message === "REMINDER_FAILED") {
        errorMessage = ERROR_MESSAGES.REMINDER_FAILED;
      }
      
      throw new Error(errorMessage);
    }
  }
};

async function processUserMessage(message) {
  if (message.webhookId || !message.author || message.author.bot) return;
  try {
    const tracked = await getTrackedMember(message.author.id);
    if (tracked) {
      await removeTrackedMember(message.author.id);
      logger.debug("User removed from mute tracking:", { user: message.author.tag });
    }
    await processTimeReferences(message);
    await incrementMessageCount(message.author.id, message.author.tag);
  } catch (error) {
    Sentry.captureException(error, {
      extra: { function: 'processUserMessage', userId: message.author.id }
    });
    logger.error("Error processing user message:", { userId: message.author.id, error });
  }
}

async function processTimeReferences(message) {
  if (!message.content) return;
  try {
    const timeReferences = extractTimeReferences(message.content);
    if (timeReferences.length > 0) {
      if (!global.timeReferenceCache) global.timeReferenceCache = new Map();
      global.timeReferenceCache.set(message.id, timeReferences);
      if (message.guild && message.channel.permissionsFor(message.guild.members.me).has('AddReactions')) {
        await message.react('🕒');
        logger.debug("Added clock reaction to message with time reference:", { messageId: message.id, references: timeReferences.map(ref => ref.text) });
      } else {
        logger.warn("Missing permission to add reactions in channel:", { channelId: message.channel.id });
      }
    }
  } catch (error) {
    Sentry.captureException(error, { extra: { function: 'processTimeReferences', messageId: message.id } });
    logger.error("Failed to process time references:", { error });
  }
}

async function checkForBumpMessages(message) {
  logger.debug("Checking message for bump:", {
    author: message.author?.tag,
    hasEmbeds: !!message.embeds,
    embedCount: message.embeds?.length,
    content: message.content?.substring(0, 100)
  });
  if (!message.embeds || message.embeds.length === 0) return;
  try {
    const bumpEmbed = message.embeds.find(embed => {
      logger.debug("Checking embed:", { description: embed.description?.substring(0, 100), hasDescription: !!embed.description });
      return embed.description && embed.description.includes("Bump done!");
    });
    if (bumpEmbed) {
      logger.info("Bump detected, scheduling reminder");
      await handleReminder(message, 7200000);
      logger.debug("Bump reminder scheduled for 2 hours.");
    }
  } catch (error) {
    Sentry.captureException(error, { extra: { function: 'checkForBumpMessages', messageId: message.id } });
    logger.error("Failed to process bump message:", { error, messageId: message.id, author: message.author?.tag });
  }
}