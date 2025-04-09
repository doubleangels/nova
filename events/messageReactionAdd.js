// events/messageReactionAdd.js
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { extractTimeReferences, createTimestampResponse } = require('../utils/timeUtils');

/**
 * Event handler for the 'messageReactionAdd' event.
 * Processes reactions to messages, specifically handling clock emoji reactions
 * to provide timezone-converted timestamps.
 *
 * @param {MessageReaction} reaction - The reaction object.
 * @param {User} user - The user who added the reaction.
 */
module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    try {
      // Ignore reactions from bots
      if (user.bot) return;
      
      // Check if this is a clock emoji reaction
      if (reaction.emoji.name === '🕒') {
        // Fetch the message if it's a partial
        if (reaction.partial) {
          try {
            await reaction.fetch();
          } catch (error) {
            logger.error("Error fetching partial reaction:", { error });
            return;
          }
        }
        
        const message = reaction.message;
        
        // If we need to fetch the full message
        if (message.partial) {
          try {
            await message.fetch();
          } catch (error) {
            logger.error("Error fetching partial message:", { error });
            return;
          }
        }
        
        // Get the parsed times from cache or re-parse if not available
        let timeReferences;
        if (global.timeReferenceCache && global.timeReferenceCache.has(message.id)) {
          timeReferences = global.timeReferenceCache.get(message.id);
        } else {
          timeReferences = extractTimeReferences(message.content);
        }
        
        if (timeReferences && timeReferences.length > 0) {
          // Create a response with Discord timestamp formats for each time reference
          const response = createTimestampResponse(timeReferences, message.content);
          
          try {
            // For Discord.js v14+, use this approach for ephemeral messages
            // This assumes you have message content intent enabled
            await message.channel.send({
              content: `<@${user.id}> ${response}`,
              // Note: true ephemeral messages are only possible with interactions
              // This will be a regular message that mentions the user
              allowedMentions: { users: [user.id] }
            });
            
            logger.debug("Sent timezone conversion to user:", { user: user.tag });
          } catch (replyError) {
            logger.error("Failed to send timezone conversion:", { error: replyError });
          }
        }
      }
    } catch (error) {
      logger.error("Error processing messageReactionAdd event:", { error });
    }
  }
};
