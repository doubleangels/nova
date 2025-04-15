// events/messageCreate.js
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { extractTimeReferences } = require('../utils/timeUtils');

/**
 * Event handler for the 'messageCreate' event.
 * Processes incoming messages to:
 *  - Remove users from mute tracking when they send a message.
 *  - Trigger a Disboard reminder when a message embed indicates a bump was done.
 *  - React with a clock emoji when a message contains time references.
 *
 * @param {Message} message - The message object from Discord.
 */
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    try {
      // Handle partial message by fetching it if needed
      if (message.partial) {
        try {
          await message.fetch();
        } catch (fetchError) {
          logger.error("Failed to fetch partial message:", { error: fetchError });
          return;
        }
      }

      // Log the received message with the author's tag and content.
      logger.debug("Message received:", {
        author: message.author?.tag || "Unknown Author",
        channelId: message.channel.id,
        content: message.content?.substring(0, 50) || "No Content" // Log only first 50 chars for privacy
      });
      
      // Process messages from real users (not webhooks or bots)
      await processUserMessage(message);
      
      // Check for bumps regardless of message source (including bots)
      await checkForBumpMessages(message);
    
    } catch (error) {
      logger.error("Error processing messageCreate event:", { error });
    }
  }
};

/**
 * Process messages from real users (not webhooks or bots)
 * @param {Message} message - The Discord message object
 */
async function processUserMessage(message) {
  if (message.webhookId || !message.author || message.author.bot) {
    return;
  }
  
  try {
    // Check if the message author is being tracked for mute mode.
    const tracked = await getTrackedMember(message.author.id);
    if (tracked) {
      await removeTrackedMember(message.author.id);
      logger.debug("User removed from mute tracking:", { user: message.author.tag });
    }
    
    // Check if the message contains time references
    await processTimeReferences(message);
  } catch (error) {
    logger.error("Error processing user message:", { 
      userId: message.author.id, 
      error 
    });
  }
}

/**
 * Process time references in messages and add clock reactions
 * @param {Message} message - The Discord message object
 */
async function processTimeReferences(message) {
  if (!message.content) return;
  
  try {
    const timeReferences = extractTimeReferences(message.content);
    if (timeReferences.length > 0) {
      // Store the parsed times in a cache
      if (!global.timeReferenceCache) {
        global.timeReferenceCache = new Map();
      }
      global.timeReferenceCache.set(message.id, timeReferences);
      
      // Check if the bot has permission to add reactions
      if (message.guild && message.channel.permissionsFor(message.guild.members.me).has('AddReactions')) {
        await message.react('🕒');
        logger.debug("Added clock reaction to message with time reference:", { 
          messageId: message.id,
          references: timeReferences.map(ref => ref.text)
        });
      } else {
        logger.warn("Missing permission to add reactions in channel:", {
          channelId: message.channel.id
        });
      }
    }
  } catch (error) {
    logger.error("Failed to process time references:", { error });
  }
}

/**
 * Check for bump messages to schedule reminders
 * @param {Message} message - The Discord message object
 */
async function checkForBumpMessages(message) {
  if (!message.embeds || message.embeds.length === 0) return;
  
  try {
    const bumpEmbed = message.embeds.find(embed =>
      embed.description && embed.description.includes("Bump done!")
    );
    
    if (bumpEmbed) {
      // Schedule a 2-hour reminder (2 hours = 7200000 milliseconds)
      await handleReminder(message, 7200000);
      logger.debug("Bump reminder scheduled for 2 hours.");
    }
  } catch (error) {
    logger.error("Failed to process bump message:", { error });
  }
}