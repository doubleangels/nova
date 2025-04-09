const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');

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
      // Log the received message with the author's tag and content.
      logger.debug("Message received:", {
        author: message.author.tag,
        content: message.content
      });
      
      // Check if the message author is being tracked for mute mode.
      const tracked = await getTrackedMember(message.author.id);
      if (tracked) {
        await removeTrackedMember(message.author.id);
        logger.debug("User removed from mute tracking:", { user: message.author.tag });
      }
      
      // Check for embeds that contain "Bump done"
      if (message.embeds && message.embeds.length > 0) {
        const bumpEmbed = message.embeds.find(embed =>
          embed.description && embed.description.includes("Bump done")
        );
        if (bumpEmbed) {
          // Schedule a 2-hour reminder (2 hours = 7200000 milliseconds)
          await handleReminder(message, 7200000);
          logger.debug("Bump reminder scheduled for 2 hours.");
        }
      }
      
      // Check if the message contains time references and react with a clock emoji
      if (containsTimeReference(message.content)) {
        try {
          await message.react('🕒');
          logger.debug("Added clock reaction to message with time reference");
        } catch (reactionError) {
          logger.error("Failed to add clock reaction:", { error: reactionError });
        }
      }
    
    } catch (error) {
      logger.error("Error processing messageCreate event:", { error });
    }
  }
};

/**
 * Checks if a string contains time references.
 * 
 * @param {string} content - The message content to check.
 * @returns {boolean} True if the content contains time references, false otherwise.
 */
function containsTimeReference(content) {
  if (!content) return false;
  
  // Regular expressions to match various time formats
  const timePatterns = [
    // 12-hour format (e.g., 3:30 PM, 11:45 am)
    /\b(1[0-2]|0?[1-9]):[0-5][0-9]\s*(am|pm|AM|PM|a\.m\.|p\.m\.)\b/,
    
    // 24-hour format (e.g., 13:45, 08:30)
    /\b([01]?[0-9]|2[0-3]):[0-5][0-9]\b/,
    
    // Words like "o'clock" (e.g., 3 o'clock)
    /\b([1-9]|1[0-2])\s*o'clock\b/i,
    
    // Time with timezone (e.g., 3:30 PM EST, 14:00 UTC)
    /\b(1[0-2]|0?[1-9]):[0-5][0-9]\s*(am|pm|AM|PM|a\.m\.|p\.m\.)?\s*[A-Z]{3,4}\b/,
    /\b([01]?[0-9]|2[0-3]):[0-5][0-9]\s*[A-Z]{3,4}\b/,
    
    // Simple hour references (e.g., at 5, at 11)
    /\bat\s+([1-9]|1[0-2])\b/i
  ];
  
  // Check if any of the patterns match
  return timePatterns.some(pattern => pattern.test(content));
}
