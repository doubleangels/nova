const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, removeMuteModeUser } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { Events } = require('discord.js');
const { cancelMuteKick } = require('../utils/muteModeUtils');
const { trackNewUserMessage } = require('../utils/spamModeUtils');

module.exports = {
  name: Events.MessageCreate,

  /**
   * Handles the event when a new message is created.
   * This function:
   * 1. Processes messages from users and specific bots
   * 2. Handles mute mode tracking
   * 3. Tracks new user messages for spam mode (duplicate detection across channels within mute mode kick time)
   * 4. Processes time references and reminders
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

      // Track new user messages for spam mode if enabled (BEFORE removing from mute mode)
      // Fetch config values in parallel
      const [spamModeEnabled, noTextChannelId] = await Promise.all([
        getValue('spam_mode_enabled'),
        getValue('notext_channel')
      ]);
      
      try {
        if (spamModeEnabled === true) {
          await trackNewUserMessage(message);
        }
      } catch (error) {
        logger.error("Error occurred while checking spam mode or tracking new user message.", {
          err: error,
          messageId: message.id
        });
      }

      // Only remove from mute mode if user was actually in mute mode (cancelMuteKick returns true)
      // This avoids unnecessary database calls for users not in mute mode
      if (cancelMuteKick(message.author.id)) {
        await removeMuteModeUser(message.author.id);
        logger.debug('Removed mute mode tracking for user after message.', {
          userTag: message.author.tag
        });
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
      
      // Check for bump messages (both Disboard with embeds and Discadia without embeds)
      await checkForBumpMessages(message);
      
      logger.debug('Processed message from user in channel.', {
        userTag: message.author.tag,
        channelName: message.channel.name
      });

      if (message.channelId !== noTextChannelId) return;

      const hasGif = message.attachments.some(attachment => 
        attachment.url.toLowerCase().endsWith('.gif') || 
        attachment.contentType?.toLowerCase() === 'image/gif'
      ) || message.content.toLowerCase().match(/(?:https?:\/\/.*\.gif(\?.*)?$|https?:\/\/(?:tenor|giphy|imgur)\.com\/.*\/.*)/i);
      
      const hasImage = message.attachments.some(attachment => 
        attachment.contentType?.toLowerCase().startsWith('image/')
      );
      
      const hasSticker = message.stickers.size > 0;

      const hasEmote = message.content.match(/<a?:\w+:\d+>/g);
      const hasTag = message.content.match(/<@!?\d+>|<@&\d+>|<#\d+>/g);

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
  // This function is kept for potential future use
  // Mute mode removal is now handled in execute() for better performance
  if (message.webhookId || !message.author || message.author.bot) return;
}



/**
 * Checks for bump messages and schedules reminders
 * Supports both Disboard (embed) and Discadia (text, no embed) bump messages
 * @param {Message} message - The message to check
 * @returns {Promise<void>}
 */
async function checkForBumpMessages(message) {
  // Get message content - always try to fetch for bot messages if content is missing
  // Sometimes Discord.js doesn't populate content immediately for interaction/webhook messages
  let messageContent = message.content;
  
      logger.debug("Checking message for bump pattern.", {
    author: message.author?.tag,
    hasEmbeds: message.embeds?.length > 0,
    embedCount: message.embeds?.length || 0,
    content: messageContent?.replace(/\n/g, ' ') || "No Content",
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
            message.embeds = fetchedMessage.embeds;
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
      }
      
      if (bumpEmbed) {
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
    
    // Check for Discadia bump (text content with "has been successfully bumped!")
    // Check ALL messages for the pattern, regardless of sender
    const discadiaBumpPattern = /has been successfully bumped!/i;
    
    // Always check message content for Discadia pattern
    let contentToCheck = messageContent;
    let embedsToCheck = message.embeds;
    
    // For webhook/interaction messages, fetch to ensure we have latest content
    if (message.partial || message.webhookId || message.interaction) {
      try {
        const fetchedMessage = await message.fetch();
        if (fetchedMessage.content) {
          contentToCheck = fetchedMessage.content;
          messageContent = fetchedMessage.content;
        }
        if (fetchedMessage.embeds && fetchedMessage.embeds.length > 0) {
          embedsToCheck = fetchedMessage.embeds;
        }
        logger.debug("Fetched message for Discadia check.", {
          label: "messageCreate.js",
          messageId: message.id,
          contentLength: contentToCheck?.length || 0,
          embedCount: embedsToCheck?.length || 0,
          author: message.author?.tag
        });
      } catch (fetchError) {
        logger.debug("Could not fetch message for Discadia check.", {
          label: "messageCreate.js",
          error: fetchError.message,
          messageId: message.id
        });
      }
    }
    
    // Check message content for Discadia pattern
    if (contentToCheck && contentToCheck.trim().length > 0 && discadiaBumpPattern.test(contentToCheck)) {
      logger.info("Discadia bump detected in content, scheduling reminder.");
      await handleReminder(message, 86400000, 'discadia'); // 24 hours in milliseconds
      logger.debug("Bump reminder scheduled for 24 hours.");
      return;
    }
    
    // Check embeds for Discadia pattern (some Discadia messages might have embeds)
    if (embedsToCheck && embedsToCheck.length > 0) {
      const discadiaEmbed = embedsToCheck.find(embed => 
        (embed.description && discadiaBumpPattern.test(embed.description)) ||
        (embed.title && discadiaBumpPattern.test(embed.title)) ||
        (embed.footer?.text && discadiaBumpPattern.test(embed.footer.text))
      );
      
      if (discadiaEmbed) {
        logger.info("Discadia bump detected in embed, scheduling reminder.");
        await handleReminder(message, 86400000, 'discadia'); // 24 hours in milliseconds
        logger.debug("Bump reminder scheduled for 24 hours.");
        return;
      }
    }
  } catch (error) {
    logger.error("Failed to process bump message.", {
      err: error,
      messageId: message.id,
      author: message.author?.tag
    });
  }
}