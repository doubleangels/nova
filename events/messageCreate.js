const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember } = require('../utils/supabase');
const { handleReminder } = require('../utils/reminderUtils');

/**
 * Event handler for the 'messageCreate' event.
 * Processes incoming messages to:
 *  - Remove users from mute tracking when they send a message.
 *  - Trigger a Disboard reminder when a message embed indicates a bump was done.
 */
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    try {
      // Log the received message with the author's tag and message content.
      logger.debug(`Message received from ${message.author.tag}: ${message.content}`);
      
      // Check if the message author is being tracked for mute mode.
      const tracked = await getTrackedMember(message.author.id);
      if (tracked) {
        // If tracked, remove the member from mute tracking.
        await removeTrackedMember(message.author.id);
        logger.debug(`User ${message.author.tag} sent a message and was removed from mute tracking.`);
      }
      
      // Check if the message contains any embeds.
      if (message.embeds && message.embeds.length > 0) {
        try {
          // Process the first embed found in the message.
          const embed = message.embeds[0];
          const embedDescription = embed.description || "";
          logger.debug(`Embed detected with description: ${embedDescription}`);
          
          // If the embed description includes "Bump done", trigger the Disboard reminder.
          if (embedDescription.includes("Bump done")) {
            logger.debug("Triggering Disboard reminder based on embed content.");
            await handleReminder(
              "disboard", 
              "Thanks for bumping the server on Disboard! I'll remind you when it's time to bump again.", 
              "It's time to bump the server on Disboard again!", 
              7200,
              client
            );
          } else {
            logger.debug("Embed does not contain 'Bump done'; no action taken.");
          }
        } catch (error) {
          // Log errors encountered during embed processing.
          logger.error(`Error processing embed content: ${error}`);
        }
      } else {
        logger.debug("No embeds found in message; skipping embed processing.");
      }
    } catch (error) {
      // Log any errors that occur during the messageCreate event processing.
      logger.error(`Error processing messageCreate event: ${error}`);
    }
  }
};
