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
          logger.error("Failed to fetch partial message:", { error: fetchError });
          throw new Error("⚠️ Failed to fetch message content.");
        }
      }

      logger.debug("Message received:", {
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
        logger.error("Error checking spam mode or tracking new user message:", {
          error: error.message,
          messageId: message.id
        });
      }

      // Only remove from mute mode if user was actually in mute mode (cancelMuteKick returns true)
      // This avoids unnecessary database calls for users not in mute mode
      if (cancelMuteKick(message.author.id)) {
        await removeMuteModeUser(message.author.id);
        logger.debug(`Removed mute mode tracking for user ${message.author.tag} after message.`);
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
      
      // Auto-react to "Dubz" or "Dubzie" mentions (case-insensitive)
      const messageContentLower = message.content?.toLowerCase() || '';
      if (messageContentLower.includes('dubz') || messageContentLower.includes('dubzie')) {
        try {
          // Get dubz emoji from database config (already fetched above)
          const dubzEmoji = await getValue('dubz_emoji');
          if (dubzEmoji) {
            await message.react(dubzEmoji);
            logger.debug(`Reacted to "Dubz"/"Dubzie" mention in message from ${message.author.tag}.`);
          }
        } catch (error) {
          logger.error("Failed to react to Dubz/Dubzie mention:", {
            error: error.message,
            messageId: message.id,
            channelId: message.channel.id
          });
        }
      }
      
      logger.debug(`Processed message from ${message.author.tag} in channel: ${message.channel.name}`);

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
          logger.debug("Deleted message with no allowed content in no-text channel:", {
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
          logger.error("Failed to delete message in no-text channel:", { 
            error: error.message,
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
      logger.error('Error processing message:', {
        error: error.stack,
        message: error.message,
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
  
  logger.debug("Checking message for bump:", {
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
    if (message.embeds && message.embeds.length > 0) {
      // Only fetch if embeds might be incomplete (partial message or missing descriptions)
      let embedsToCheck = message.embeds;
      if (message.partial || message.embeds.some(e => !e.description)) {
        try {
          const fetchedMessage = await message.fetch();
          if (fetchedMessage.embeds && fetchedMessage.embeds.length > 0) {
            embedsToCheck = fetchedMessage.embeds;
            message.embeds = fetchedMessage.embeds;
            logger.debug("Fetched message embeds for Disboard check:", {
              label: "messageCreate.js",
              embedCount: fetchedMessage.embeds.length,
              messageId: message.id
            });
          }
        } catch (fetchError) {
          logger.debug("Could not fetch message for Disboard check:", {
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
        logger.debug("Found Disboard bump embed");
      }
      
      if (bumpEmbed) {
        logger.info("Disboard bump detected, scheduling reminder.");
        await handleReminder(message, 7200000, 'bump');
        logger.debug("Bump reminder scheduled for 2 hours.");
        return;
      }
    } else {
      logger.debug("No message embeds available for Disboard check:", {
        label: "messageCreate.js",
        messageId: message.id,
        author: message.author?.tag,
        hasWebhook: !!message.webhookId,
        isInteraction: !!message.interaction
      });
    }
    
    // Check for Discadia bump (text content with "has been successfully bumped!")
    // For interaction/webhook messages, content might be in embeds or need fetching
    // Always fetch interaction/webhook messages to ensure we have full data
    // Also fetch if content is missing - it might be populated after fetch
    // For Discadia bot messages, also check if author name matches
    const isDiscadiaBot = message.author?.username === 'Discadia' || message.author?.tag?.startsWith('Discadia#');
    
    if (message.webhookId || message.interaction || !messageContent || messageContent.trim().length === 0 || isDiscadiaBot) {
      try {
        const fetchedMessage = await message.fetch();
        // Update messageContent and embeds from fetched message
        messageContent = fetchedMessage.content || messageContent;
        if (fetchedMessage.embeds && fetchedMessage.embeds.length > 0) {
          message.embeds = fetchedMessage.embeds;
        }
        logger.debug("Fetched message for Discadia check (webhook/interaction/missing content/discadia bot):", {
          label: "messageCreate.js",
          messageId: message.id,
          hasContent: !!messageContent,
          contentLength: messageContent?.length || 0,
          embedCount: message.embeds?.length || 0,
          author: message.author?.tag,
          isDiscadiaBot,
          reason: message.webhookId ? 'webhook' : message.interaction ? 'interaction' : isDiscadiaBot ? 'discadia bot' : 'missing content'
        });
      } catch (fetchError) {
        logger.debug("Could not fetch message for Discadia check:", { 
          error: fetchError.message,
          messageId: message.id
        });
      }
    }
    
    // Check content for Discadia pattern
    const discadiaBumpPattern = /has been successfully bumped!/i;
    let patternMatch = false;
    let matchedContent = null;
    
    // Check message content first
    if (messageContent && messageContent.trim().length > 0) {
      patternMatch = discadiaBumpPattern.test(messageContent);
      if (patternMatch) {
        matchedContent = messageContent;
      }
    }
    
    // If not found in content, check embeds (Discadia might put text in embeds)
    if (!patternMatch && message.embeds && message.embeds.length > 0) {
      for (const embed of message.embeds) {
        // Check embed description
        if (embed.description && discadiaBumpPattern.test(embed.description)) {
          patternMatch = true;
          matchedContent = embed.description;
          break;
        }
        // Check embed title
        if (embed.title && discadiaBumpPattern.test(embed.title)) {
          patternMatch = true;
          matchedContent = embed.title;
          break;
        }
        // Check embed footer
        if (embed.footer?.text && discadiaBumpPattern.test(embed.footer.text)) {
          patternMatch = true;
          matchedContent = embed.footer.text;
          break;
        }
        // Check all embed fields
        if (embed.fields && embed.fields.length > 0) {
          for (const field of embed.fields) {
            if (field.value && discadiaBumpPattern.test(field.value)) {
              patternMatch = true;
              matchedContent = field.value;
              break;
            }
            if (field.name && discadiaBumpPattern.test(field.name)) {
              patternMatch = true;
              matchedContent = field.name;
              break;
            }
          }
        }
        if (patternMatch) break;
      }
    }
    
    // Additional check: If message is from Discadia bot and is an interaction response,
    // check if we can infer it's a bump (some interaction responses don't have content)
    // Note: This is a fallback - we still prefer pattern matching when possible
    if (!patternMatch && isDiscadiaBot && message.interaction) {
      logger.debug("Discadia bot interaction detected but pattern not found - may need different detection method:", {
        messageId: message.id,
        interactionType: message.interaction.type,
        hasContent: !!messageContent,
        embedCount: message.embeds?.length || 0
      });
    }
    
    logger.debug("Discadia pattern check:", {
      patternMatch,
      hasContent: !!messageContent,
      contentLength: messageContent?.length || 0,
      embedCount: message.embeds?.length || 0,
      matchedIn: patternMatch ? (matchedContent === messageContent ? 'content' : 'embed') : 'none',
      matchedContent: patternMatch ? matchedContent?.substring(0, 100) : null
    });
    
    if (patternMatch) {
      logger.info("Discadia bump detected, scheduling reminder.");
      await handleReminder(message, 86400000, 'discadia'); // 24 hours in milliseconds
      logger.debug("Bump reminder scheduled for 24 hours.");
      return;
    }
  } catch (error) {
    logger.error("Failed to process bump message:", { error, messageId: message.id, author: message.author?.tag });
  }
}