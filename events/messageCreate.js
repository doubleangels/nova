const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const chrono = require('chrono-node');

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
      
      // Check if the message contains time references using chrono-node
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
 * Checks if a string contains time references using chrono-node.
 * 
 * @param {string} content - The message content to check.
 * @returns {boolean} True if the content contains time references, false otherwise.
 */
function containsTimeReference(content) {
  if (!content) return false;
  
  // Use chrono-node to parse potential dates/times from the message
  const results = chrono.parse(content);
  
  // If chrono found any date/time references, return true
  return results.length > 0;
}
