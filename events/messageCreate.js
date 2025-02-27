const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember } = require('../utils/supabase');
const { handleReminder } = require('../utils/reminderUtils');

/**
 * Event handler for the 'messageCreate' event.
 * Processes incoming messages to:
 *  - Remove users from mute tracking when they send a message.
 *  - Trigger a Disboard reminder when a message embed indicates a bump was done.
 *
 * @param {Message} message - The message object from Discord.
 */
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    try {
      // Log the received message with the author's tag and content.
      logger.debug("Message received", {
        author: message.author.tag,
        content: message.content
      });
      
      // Check if the message author is being tracked for mute mode.
      const tracked = await getTrackedMember(message.author.id);
      if (tracked) {
        await removeTrackedMember(message.author.id);
        logger.debug("User removed from mute tracking", { user: message.author.tag });
      }
      
      // Process embeds if they exist.
      if (message.embeds && message.embeds.length > 0) {
        try {
          const embed = message.embeds[0];
          const embedDescription = embed.description || "";
          logger.debug("Embed detected", { embedDescription });
          
          // Check if embed description indicates a Disboard bump.
          if (embedDescription.includes("Bump done")) {
            logger.debug("Disboard bump detected in embed; triggering reminder.");
            await handleReminder(
              "disboard", 
              "Thanks for bumping the server on Disboard! I'll remind you when it's time to bump again.", 
              "It's time to bump the server on Disboard again!", 
              7200,
              message.client
            );
          } else {
            logger.debug("Embed does not indicate a bump; no reminder triggered.");
          }
        } catch (embedError) {
          logger.error("Error processing embed content", { error: embedError });
        }
      } else {
        logger.debug("No embeds found in message; skipping embed processing.");
      }
    } catch (error) {
      logger.error("Error processing messageCreate event", { error });
    }
  }
};
