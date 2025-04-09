// events/messageReactionAdd.js
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone } = require('../utils/database');
const { formatTimeReferences, convertTimeToTimezone } = require('../utils/timeUtils');

/**
 * Event handler for the 'messageReactionAdd' event.
 * Processes reactions added to messages, specifically handling clock emoji reactions
 * to provide time zone conversions for time references in messages.
 *
 * @param {MessageReaction} reaction - The reaction object.
 * @param {User} user - The user who added the reaction.
 */
module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    try {
      // Skip if the reaction is from a bot
      if (user.bot) return;
      
      // Handle partial reactions by fetching complete data if needed
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          logger.error("Failed to fetch partial reaction:", { error });
          return;
        }
      }
      
      // Handle partial messages by fetching complete data if needed
      if (reaction.message.partial) {
        try {
          await reaction.message.fetch();
        } catch (error) {
          logger.error("Failed to fetch partial message:", { error });
          return;
        }
      }
      
      logger.debug("Reaction added:", {
        emoji: reaction.emoji.name,
        messageId: reaction.message.id,
        user: user.tag
      });
      
      // Check if the reaction is a clock emoji
      if (reaction.emoji.name === '🕒') {
        // Get the user's timezone from the database
        const userTimezone = await getUserTimezone(user.id);
        
        if (!userTimezone) {
          logger.debug("User has no timezone set:", { userId: user.id });
          try {
            await user.send({
              content: `You haven't set your timezone yet. Please use the \`/timezone set\` command to set your timezone.`
            });
          } catch (dmError) {
            logger.error("Failed to send timezone reminder DM:", { error: dmError });
          }
          return;
        }
        
        // Get the cached time references for this message
        let timeReferences = global.timeReferenceCache?.get(reaction.message.id);
        
        // If no cached references, try to extract them from the message content
        if (!timeReferences && reaction.message.content) {
          const { extractTimeReferences } = require('../utils/timeUtils');
          timeReferences = extractTimeReferences(reaction.message.content);
          
          // Store these in the cache for future use
          if (timeReferences.length > 0) {
            if (!global.timeReferenceCache) {
              global.timeReferenceCache = new Map();
            }
            global.timeReferenceCache.set(reaction.message.id, timeReferences);
            
            logger.debug("Re-extracted time references for message:", {
              messageId: reaction.message.id,
              references: timeReferences.map(ref => ref.text)
            });
          }
        }
        
        if (timeReferences && timeReferences.length > 0) {
          logger.debug("Processing clock reaction for time references:", {
            messageId: reaction.message.id,
            references: timeReferences.map(ref => ref.text),
            userTimezone: userTimezone
          });
          
          try {
            // Convert the time references to the user's timezone
            const convertedTimes = timeReferences.map(ref => {
              return convertTimeToTimezone(ref, userTimezone);
            });
            
            // Format the converted times for display
            const formattedTimes = formatTimeReferences(convertedTimes, userTimezone);
            
            // Create a message with the original message link and the time conversions
            const messageContent = `Here are the time conversions for your timezone (${userTimezone}):\n\n${formattedTimes}\n\nOriginal message: ${reaction.message.url}`;
            
            // Send a DM to the user with the time conversions
            await user.send({ content: messageContent });
            
            logger.debug("Sent time conversions to user:", { user: user.tag, timezone: userTimezone });
          } catch (dmError) {
            logger.error("Failed to send DM with time conversions:", { error: dmError });
            
            // If DM fails, try to reply in the channel
            try {
              await reaction.message.reply({
                content: `<@${user.id}>, I couldn't send you a DM. Please check your privacy settings.`,
                ephemeral: true
              });
            } catch (replyError) {
              logger.error("Failed to reply in channel:", { error: replyError });
            }
          }
        } else {
          logger.debug("No time references found for message:", { messageId: reaction.message.id });
        }
      }
    } catch (error) {
      logger.error("Error processing messageReactionAdd event:", { error });
    }
  }
};
