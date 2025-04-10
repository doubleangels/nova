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
        content: message.content || "No Content"
      });
      
      // Handle user-specific actions only for non-bot messages
      if (!message.webhookId && message.author && !message.author.bot) {
        // Check if the message author is being tracked for mute mode.
        const tracked = await getTrackedMember(message.author.id);
        if (tracked) {
          await removeTrackedMember(message.author.id);
          logger.debug("User removed from mute tracking:", { user: message.author.tag });
        }
        
        // Check if the message contains time references using chrono-node
        if (message.content) {
          const timeReferences = extractTimeReferences(message.content);
          if (timeReferences.length > 0) {
            try {
              // Store the parsed times in a cache or database
              // We'll use a simple Map in the global scope for this example
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
            } catch (reactionError) {
              logger.error("Failed to add clock reaction:", { error: reactionError });
            }
          }
        }
      }
      
      // Check for bumps regardless of message source (including bots)
      if (message.embeds && message.embeds.length > 0) {
        const bumpEmbed = message.embeds.find(embed =>
          embed.description && embed.description.includes("Bump done!")
        );
        if (bumpEmbed) {
          // Schedule a 2-hour reminder (2 hours = 7200000 milliseconds)
          await handleReminder(message, 7200000);
          logger.debug("Bump reminder scheduled for 2 hours.");
        }
      }
    
    } catch (error) {
      logger.error("Error processing messageCreate event:", { error });
    }
  }
};
