const logger = require('../logger');
const { getTrackedMember, removeTrackedMember } = require('../utils/supabase');
const { disboard } = require('../commands/reminders');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    try {
      logger.debug(`Message received from ${message.author.tag}: ${message.content}`);
      
      // Remove the user from mute tracking if they send a message.
      const tracked = await getTrackedMember(message.author.id);
      if (tracked) {
        await removeTrackedMember(message.author.id);
        logger.debug(`User ${message.author.tag} sent a message and was removed from mute tracking.`);
      }
      
      // Process the message if it contains embeds.
      if (message.embeds && message.embeds.length > 0) {
        try {
          // Use the first embed in the message.
          const embed = message.embeds[0];
          // Some embeds might not have a description, so default to an empty string.
          const embedDescription = embed.description || "";
          logger.debug(`Embed detected with description: ${embedDescription}`);
          
          if (embedDescription.includes("Bump done")) {
            logger.debug("Triggering Disboard reminder based on embed content.");
            await disboard();
          } else {
            logger.debug("Embed does not contain 'Bump done'; no action taken.");
          }
        } catch (error) {
          logger.error(`Error processing embed content: ${error}`);
        }
      } else {
        logger.debug("No embeds found in message; skipping embed processing.");
      }
    } catch (error) {
      logger.error(`Error processing messageCreate event: ${error}`);
    }
  }
};
