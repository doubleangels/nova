const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getValue, removeMuteModeUser } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { Events } = require('discord.js');
const { cancelMuteKick } = require('../utils/muteModeUtils');

module.exports = {
  name: Events.MessageCreate,

  /**
   * Handles the event when a new message is created.
   * This function:
   * 1. Processes messages from users and specific bots
   * 2. Handles mute mode tracking
   * 3. Processes time references and reminders
   * 4. Manages no-text channel restrictions
   * 
   * @param {Message} message - The message that was created
   * @throws {Error} If there's an error processing the message
   * @returns {Promise<void>}
   */
  async execute(message) {
    if (message.author.bot && !message.author.tag.toLowerCase().includes('disboard') && !message.author.tag.toLowerCase().includes('nova')) return;

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

      await removeMuteModeUser(message.author.id);

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
      
      if (message.embeds && message.embeds.length > 0) {
        await checkForBumpMessages(message);
      }
      
      logger.debug(`Processed message from ${message.author.tag} in channel: ${message.channel.name}`);

      const noTextChannelId = await getValue('no_text_channel');
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
            content: "⚠️ Failed to process the message.",
            ephemeral: true
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
  if (message.webhookId || !message.author || message.author.bot) return;
  try {
    if (cancelMuteKick(message.author.id)) {
      await removeMuteModeUser(message.author.id);
      logger.debug(`Removed mute mode tracking for user ${message.author.tag} after message`);
    }
  } catch (error) {
    logger.error("Error processing user message:", { userId: message.author.id, error });
  }
}



/**
 * Checks for bump messages and schedules reminders
 * @param {Message} message - The message to check
 * @returns {Promise<void>}
 */
async function checkForBumpMessages(message) {
  logger.debug("Checking message for bump:", {
    author: message.author?.tag,
    hasEmbeds: message.embeds?.length > 0,
    embedCount: message.embeds?.length || 0,
    content: message.content?.replace(/\n/g, ' ') || "No Content"
  });
  
  if (!message.embeds || message.embeds.length === 0) return;
  
  try {
    const bumpEmbed = message.embeds.find(embed => {
      logger.debug("Checking embed:", { 
        description: embed.description?.replace(/\n/g, ' ') || "No Description", 
        hasDescription: !!embed.description 
      });
      return embed.description && embed.description.includes("Bump done!");
    });
    
    if (bumpEmbed) {
      logger.info("Bump detected, scheduling reminder");
      await handleReminder(message, 7200000);
      logger.debug("Bump reminder scheduled for 2 hours.");
    }
  } catch (error) {
    logger.error("Failed to process bump message:", { error, messageId: message.id, author: message.author?.tag });
  }
}