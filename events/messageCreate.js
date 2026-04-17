const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { captureError } = require('../instrument');
const config = require('../config');
const { getValue, removeMuteModeUser, incrementMessageCount, deleteMessageCount, getMessageCount, updateLastMessageTime } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { Events } = require('discord.js');

module.exports = {
  name: Events.MessageCreate,

  /**
   * Handles the event when a new message is created.
   * This function:
   * 1. Processes messages from users and specific bots
   * 2. Processes time references and reminders
   * 5. Manages no-text channel restrictions
   * 
   * @param {Message} message - The message that was created
   * @throws {Error} If there's an error processing the message
   * @returns {Promise<void>}
   */
  async execute(message) {
    try {
      if (message.partial) {
        try {
          await message.fetch();
        } catch (fetchError) {
          logger.error("Failed to fetch partial message.", {
            err: fetchError
          });
          throw new Error("⚠️ Failed to fetch message content.");
        }
      }

      logger.debug("Message received from user.", {
        author: message.author?.tag || "Unknown Author",
        channelId: message.channel.id,
        content: message.content?.replace(/\n/g, ' ') || "No Content"
      });

      // Fetch config values in parallel
      const [noTextChannelId] = await Promise.all([
        getValue('notext_channel')
      ]);

      if (message.content?.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        switch (command) {
          case 'ping':
            await message.reply('Pong!');
            break;
        }
      }

      if (!message.author?.bot && !message.webhookId) {
        updateLastMessageTime(message.author.id).catch(err => {
            logger.error('Background last message tracking error', { err });
        });
      }

      await processUserMessage(message);

      // Check for bump messages (Disboard with embeds)
      if (message.embeds?.length > 0) {
        await checkForBumpMessages(message);
      }

      // Handle Auto-Reactions
      await handleAutoReactions(message);

      logger.debug('Processed message from user in channel.', {
        userTag: message.author.tag,
        channelName: message.channel.name
      });

      // Skip bots and webhooks for no-text channel enforcement
      if (message.author?.bot || message.webhookId) return;
      if (String(message.channelId) !== String(noTextChannelId)) return;

      const content = message.content ?? '';
      const hasGif = message.attachments.some(attachment =>
        attachment.url.toLowerCase().endsWith('.gif') ||
        attachment.contentType?.toLowerCase() === 'image/gif'
      ) || content.toLowerCase().match(/(?:https?:\/\/.*\.gif(\?.*)?$|https?:\/\/(?:tenor|giphy|imgur)\.com\/.*\/.*)/i);

      const hasImage = message.attachments.some(attachment =>
        attachment.contentType?.toLowerCase().startsWith('image/')
      );

      const hasSticker = message.stickers.size > 0;

      const hasEmote = content.match(/<a?:\w+:\d+>/g);
      const hasTag = content.match(/<@!?\d+>|<@&\d+>|<#\d+>/g);

      if (!hasGif && !hasImage && !hasSticker && !hasEmote && !hasTag) {
        try {
          await message.delete();
          logger.debug("Deleted message with no allowed content in no-text channel.", {
            channelId: message.channelId,
            userId: message.author.id,
            messageId: message.id,
            hasGif,
            hasImage,
            hasSticker,
            hasEmote,
            hasTag,
            contentType: message.attachments.map(a => a.contentType),
            content: message.content
          });
        } catch (error) {
          captureError(error, { event: 'messageCreate', handler: 'noTextChannelDelete' });
          logger.error("Failed to delete message in no-text channel.", {
            err: error,
            channelId: message.channelId,
            userId: message.author.id,
            messageId: message.id
          });
          return await message.channel.send({
            content: "⚠️ Failed to process the message."
          });
        }
      }

    } catch (error) {
      captureError(error, { event: 'messageCreate' });
      logger.error('Error occurred while processing message.', {
        err: error,
        userId: message.author.id,
        messageId: message.id
      });

      let errorMessage = "⚠️ An unexpected error occurred while processing the message.";

      if (error.message === "⚠️ Failed to fetch message content.") {
        errorMessage = "⚠️ Failed to fetch message content.";
      } else if (error.message === "⚠️ Failed to track message data.") {
        errorMessage = "⚠️ Failed to track message data.";
      } else if (error.message === "⚠️ Failed to process bump message.") {
        errorMessage = "⚠️ Failed to process bump message.";
      } else if (error.message === "⚠️ Database error occurred while processing message.") {
        errorMessage = "⚠️ Database error occurred while processing message.";
      } else if (error.message === "⚠️ Insufficient permissions to process message.") {
        errorMessage = "⚠️ Insufficient permissions to process message.";
      } else if (error.message === "⚠️ Invalid message data received.") {
        errorMessage = "⚠️ Invalid message data received.";
      } else if (error.message === "⚠️ Failed to set reminder for bump message.") {
        errorMessage = "⚠️ Failed to set reminder for bump message.";
      }

      throw new Error(errorMessage);
    }
  }
};

/**
 * Processes a user message and handles mute mode tracking
 * @param {Message} message - The message to process
 * @returns {Promise<void>}
 */
async function processUserMessage(message) {
  if (message.webhookId || !message.author || message.author.bot) return;

  try {
    const { noobiesRoleId, givePermsFrenRoleId: frenRoleId } = config;

    // Check if roles are configured
    if (!noobiesRoleId || !frenRoleId) return;

    if (!message.member) return; // Happens sometimes in DM or uncached members

    const hasFrenRole = message.member.roles.cache.has(frenRoleId);
    const hasNoobiesRole = message.member.roles.cache.has(noobiesRoleId);

    if (hasFrenRole) {
      if (hasNoobiesRole) {
        await message.member.roles.remove(noobiesRoleId, 'Removed Noobies role automatically (has Fren role)');
        logger.debug('Removed Noobies role.', { userId: message.author.id });
      }
      // Only delete the message count once if it actually exists — avoids a no-op DB call on every message
      const existingCount = await getMessageCount(message.author.id);
      if (existingCount > 0) {
        await deleteMessageCount(message.author.id);
        logger.debug('Deleted message count for Fren user.', { userId: message.author.id });
      }
      return; // Stop processing further
    }

    const messageCount = await incrementMessageCount(message.author.id);
    if (messageCount === null) {
      // DB error occurred — skip role logic to avoid making incorrect role decisions
      logger.warn('Skipping Noobies role check due to message count DB error.', { userId: message.author.id });
      return;
    }
    const shouldHaveNoobiesRole = messageCount < 100;

    if (shouldHaveNoobiesRole && !hasNoobiesRole) {
      await message.member.roles.add(noobiesRoleId, 'Assigned Noobies role automatically (< 100 messages)');
      logger.debug('Assigned Noobies role.', { userId: message.author.id, messageCount });
    } else if (!shouldHaveNoobiesRole && hasNoobiesRole) {
      await message.member.roles.remove(noobiesRoleId, 'Removed Noobies role automatically (>= 100 messages)');
      logger.debug('Removed Noobies role.', { userId: message.author.id, messageCount });
      // Delete message count from database since they passed the threshold
      await deleteMessageCount(message.author.id);
    }
  } catch (error) {
    captureError(error, { event: 'messageCreate', handler: 'processUserMessage' });
    logger.error('Error handling role assignment in processUserMessage.', {
      err: error,
      userId: message.author.id
    });
  }
}

/**
 * Checks message content against auto-reaction regex patterns and reacts if matched.
 * Uses a short-lived in-memory cache to reduce DB load.
 */
let reactionsCache = { data: null, lastFetch: 0 };
async function handleAutoReactions(message) {
  if (!message.content || message.author.bot) return;

  try {
    const now = Date.now();
    if (!reactionsCache.data || (now - reactionsCache.lastFetch) > 60000) {
      reactionsCache.data = await getValue('auto_reactions') || [];
      reactionsCache.lastFetch = now;
    }

    if (reactionsCache.data.length === 0) return;

    for (const entry of reactionsCache.data) {
      try {
        const regex = new RegExp(entry.regex, 'i');
        if (regex.test(message.content)) {
          // Resolve emoji - could be a custom emoji ID or a unicode character
          await message.react(entry.emoji).catch(() => {
              logger.warn('Failed to react with emoji. Might be invalid or bot lacks permissions.', {
                  emoji: entry.emoji,
                  messageId: message.id
              });
          });
        }
      } catch (regexErr) {
        logger.error('Invalid auto-reaction regex pattern.', {
          pattern: entry.regex,
          err: regexErr.message
        });
      }
    }
  } catch (err) {
    logger.error('Error processing auto-reactions.', { err });
  }
}



/**
 * Checks for bump messages and schedules reminders
 * Supports Disboard (embed) bump messages
 * @param {Message} message - The message to check
 * @returns {Promise<void>}
 */
async function checkForBumpMessages(message) {
  logger.debug("Checking message for bump pattern.", {
    author: message.author?.tag,
    hasEmbeds: message.embeds?.length > 0,
    embedCount: message.embeds?.length || 0,
    content: message.content?.replace(/\n/g, ' ') || "No Content",
    hasWebhook: !!message.webhookId,
    isInteraction: !!message.interaction,
    isPartial: message.partial
  });

  try {
    // Check for Disboard bump (has embed with "Bump done!")
    // Check ALL messages for the pattern, regardless of sender
    if (message.embeds && message.embeds.length > 0) {
      // Only fetch if embeds might be incomplete (partial message or missing descriptions)
      let embedsToCheck = message.embeds;
      if (message.partial || message.embeds.some(e => !e.description)) {
        try {
          const fetchedMessage = await message.fetch();
          if (fetchedMessage.embeds && fetchedMessage.embeds.length > 0) {
            embedsToCheck = fetchedMessage.embeds;
            logger.debug("Fetched message embeds for Disboard check.", {
              label: "messageCreate.js",
              embedCount: fetchedMessage.embeds.length,
              messageId: message.id
            });
          }
        } catch (fetchError) {
          logger.debug("Could not fetch message for Disboard check.", {
            label: "messageCreate.js",
            error: fetchError.message,
            messageId: message.id
          });
        }
      }

      // Check embeds without logging on every iteration
      const bumpEmbed = embedsToCheck.find(embed =>
        embed.description && embed.description.includes("Bump done!")
      );

      if (bumpEmbed) {
        logger.debug("Found Disboard bump embed in message.");
        logger.info("Disboard bump detected, scheduling reminder.");
        await handleReminder(message, 7200000, 'bump');
        logger.debug("Bump reminder scheduled for 2 hours.");
        return;
      }
    } else {
      logger.debug("No message embeds available for Disboard check.", {
        label: "messageCreate.js",
        messageId: message.id,
        author: message.author?.tag,
        hasWebhook: !!message.webhookId,
        isInteraction: !!message.interaction
      });
    }
  } catch (error) {
    captureError(error, { event: 'messageCreate', handler: 'checkForBumpMessages' });
    logger.error("Failed to process bump message.", {
      err: error,
      messageId: message.id,
      author: message.author?.tag
    });
  }
}