const path = require('path');
const logger = require('../logger')(path.basename(__filename));

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
        
        // Re-parse the message content if parsedTimes isn't available
        // (This might happen if the bot was restarted since the original message was processed)
        const timeReferences = message.parsedTimes || extractTimeReferences(message.content);
        
        if (timeReferences && timeReferences.length > 0) {
          // Create a response with Discord timestamp formats for each time reference
          const response = createTimestampResponse(timeReferences, message.content);
          
          // Send an ephemeral reply to the user who reacted
          try {
            // Check if we're in a guild (server) context
            if (message.guild) {
              // Get the channel
              const channel = message.channel;
              
              // Send ephemeral message using Discord.js v14 approach
              await channel.send({
                content: response,
                ephemeral: true,
                // Target the user who reacted
                allowedMentions: { users: [user.id] },
                // Make sure only the user who reacted can see this
                reply: { messageReference: message.id, failIfNotExists: false }
              });
              
              logger.debug("Sent timezone conversion to user:", { user: user.tag });
            }
          } catch (replyError) {
            logger.error("Failed to send ephemeral timezone conversion:", { error: replyError });
          }
        }
      }
    } catch (error) {
      logger.error("Error processing messageReactionAdd event:", { error });
    }
  }
};

/**
 * Creates a response message with Discord timestamp formats.
 * 
 * @param {Array} timeReferences - Array of parsed time references.
 * @param {string} originalContent - The original message content.
 * @returns {string} Formatted response with Discord timestamps.
 */
function createTimestampResponse(timeReferences, originalContent) {
  let response = "**Time Conversion**\n";
  
  timeReferences.forEach(ref => {
    const timestamp = Math.floor(ref.date.getTime() / 1000);
    
    response += `> "${ref.text}"\n`;
    response += `<t:${timestamp}> (your local time)\n`;
    response += `<t:${timestamp}:F> (full date/time)\n`;
    response += `<t:${timestamp}:R> (relative time)\n\n`;
  });
  
  return response;
}

// Make sure to export the extractTimeReferences function so it's available to both modules
module.exports.extractTimeReferences = extractTimeReferences;
