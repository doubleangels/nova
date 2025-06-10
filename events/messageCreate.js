/**
 * Event handler for new messages in Discord channels.
 * Handles message processing, command parsing, and bot responses.
 * @module events/messageCreate
 */

const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember, incrementMessageCount, incrementChannelMessageCount, getValue } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { extractTimeReferences } = require('../utils/timeUtils');
const Sentry = require('../sentry');
const { logError } = require('../errors');
const { Events } = require('discord.js');

const MESSAGE_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while processing the message.";
const MESSAGE_ERROR_PROCESSING = "⚠️ Failed to process the message.";
const MESSAGE_ERROR_FETCH = "⚠️ Failed to fetch message content.";
const MESSAGE_ERROR_TRACKING = "⚠️ Failed to track message data.";
const MESSAGE_ERROR_TIME_REFERENCE = "⚠️ Failed to process time references.";
const MESSAGE_ERROR_BUMP = "⚠️ Failed to process bump message.";
const MESSAGE_ERROR_DATABASE = "⚠️ Database error occurred while processing message.";
const MESSAGE_ERROR_PERMISSION = "⚠️ Insufficient permissions to process message.";
const MESSAGE_ERROR_INVALID = "⚠️ Invalid message data received.";
const MESSAGE_ERROR_REMINDER = "⚠️ Failed to set reminder for bump message.";

const NOTEXT_DB_KEY = 'notext_channel';

/**
 * Event handler for message creation events.
 * @type {Object}
 */
module.exports = {
  name: Events.MessageCreate,
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
          throw new Error(MESSAGE_ERROR_FETCH);
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

      // Check if this is a no-text channel
      const noTextChannelId = await getValue(NOTEXT_DB_KEY);
      if (message.channelId !== noTextChannelId) return;

      // Check if message contains only GIFs or stickers
      const hasGif = message.attachments.some(attachment => 
        attachment.url.toLowerCase().endsWith('.gif') || 
        attachment.contentType?.toLowerCase() === 'image/gif'
      ) || message.content.toLowerCase().match(/(?:https?:\/\/.*\.gif(\?.*)?$|https?:\/\/(?:tenor|giphy|imgur)\.com\/.*\/.*)/i);
      const hasSticker = message.stickers.size > 0;

      // Check for emotes and tags
      const hasEmote = message.content.match(/<a?:\w+:\d+>/g); // Matches both animated and static emotes
      const hasTag = message.content.match(/<@!?\d+>|<@&\d+>|<#\d+>/g); // Matches user mentions, role mentions, and channel mentions

      // If message doesn't contain any allowed content, delete it
      if (!hasGif && !hasSticker && !hasEmote && !hasTag) {
        try {
          await message.delete();
          logger.debug("Deleted message with no allowed content in no-text channel:", {
            channelId: message.channelId,
            userId: message.author.id,
            messageId: message.id,
            hasGif,
            hasSticker,
            hasEmote,
            hasTag,
            contentType: message.attachments.map(a => a.contentType),
            content: message.content
          });
        } catch (error) {
          logger.error("Failed to delete message in no-text channel:", { 
            error: error.message,
            channelId: message.channelId,
            userId: message.author.id,
            messageId: message.id
          });
          return await message.channel.send({
            content: MESSAGE_ERROR_PROCESSING,
            ephemeral: true
          });
        }
      }

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

      let errorMessage = MESSAGE_ERROR_UNEXPECTED;
      
      if (error.message === MESSAGE_ERROR_FETCH) {
        errorMessage = MESSAGE_ERROR_FETCH;
      } else if (error.message === MESSAGE_ERROR_TRACKING) {
        errorMessage = MESSAGE_ERROR_TRACKING;
      } else if (error.message === MESSAGE_ERROR_TIME_REFERENCE) {
        errorMessage = MESSAGE_ERROR_TIME_REFERENCE;
      } else if (error.message === MESSAGE_ERROR_BUMP) {
        errorMessage = MESSAGE_ERROR_BUMP;
      } else if (error.message === MESSAGE_ERROR_DATABASE) {
        errorMessage = MESSAGE_ERROR_DATABASE;
      } else if (error.message === MESSAGE_ERROR_PERMISSION) {
        errorMessage = MESSAGE_ERROR_PERMISSION;
      } else if (error.message === MESSAGE_ERROR_INVALID) {
        errorMessage = MESSAGE_ERROR_INVALID;
      } else if (error.message === MESSAGE_ERROR_REMINDER) {
        errorMessage = MESSAGE_ERROR_REMINDER;
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