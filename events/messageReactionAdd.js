const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone } = require('../utils/database');
const { extractTimeReferences, convertTimeZones, formatConvertedTimes } = require('../utils/timeUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Extend dayjs with timezone capabilities
dayjs.extend(utc);
dayjs.extend(timezone);

module.exports = {
  name: 'messageReactionAdd',
  
  /**
   * Handles the messageReactionAdd event for time conversion functionality.
   * 
   * This function processes reactions added to messages, specifically looking for
   * the clock emoji. When detected, it checks if both the reactor and message author
   * have set timezones, extracts time references from the message content, and converts
   * those times between the two users' timezones.
   *
   * @param {MessageReaction} reaction - The Discord.js MessageReaction object
   * @param {User} user - The Discord.js User who added the reaction
   * @returns {Promise<void>}
   */
  async execute(reaction, user) {
    try {
      // Ignore reactions from bots
      if (user.bot) return;
      
      // Handle partial reactions by fetching the complete data
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          logger.error("Failed to fetch partial reaction:", { error });
          return;
        }
      }
      
      // Handle partial messages by fetching the complete data
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
      
      // Process only clock emoji reactions for time conversion
      if (reaction.emoji.name === '🕒') {
        // Get the reactor's timezone from database
        const userTimezone = await getUserTimezone(user.id);
        
        // Handle case where reactor has no timezone set
        if (!userTimezone) {
          logger.debug("User has no timezone set:", { userId: user.id });
          try {
            // Send a temporary reminder to set timezone
            const reply = await reaction.message.channel.send(
              `⚠️ <@${user.id}>, you haven't set your timezone yet. Please use the \`/timezone\` command to set your timezone.`
            ).catch(err => {
              logger.error("Failed to send timezone reminder message:", { 
                error: err.message || err.toString(),
                stack: err.stack
              });
              return null;
            });
            
            // Delete the reminder after 30 seconds
            if (reply) {
              setTimeout(() => {
                reply.delete().catch(err => 
                  logger.error("Failed to delete temporary message:", { 
                    error: err.message || err.toString() 
                  })
                );
              }, 30000);
            }
          } catch (replyError) {
            logger.error("Failed to send timezone reminder:", { 
              error: replyError.message || replyError.toString(),
              stack: replyError.stack
            });
          }
          return;
        }
        
        // Get the message author's timezone from database
        const messageAuthorId = reaction.message.author.id;
        const messageAuthorTimezone = await getUserTimezone(messageAuthorId);
        
        // Handle case where message author has no timezone set
        if (!messageAuthorTimezone) {
          logger.debug("Message author has no timezone set:", { authorId: messageAuthorId });
          try {
            // Send a temporary notification about missing author timezone
            const reply = await reaction.message.channel.send(
              `⚠️ <@${user.id}>, the author of that message hasn't set their timezone yet, so I can't convert the time accurately.`
            ).catch(err => {
              logger.error("Failed to send author timezone missing message:", { 
                error: err.message || err.toString(),
                stack: err.stack
              });
              return null;
            });
            
            // Delete the notification after 30 seconds
            if (reply) {
              setTimeout(() => {
                reply.delete().catch(err => 
                  logger.error("Failed to delete temporary message:", { 
                    error: err.message || err.toString() 
                  })
                );
              }, 30000);
            }
          } catch (replyError) {
            logger.error("Failed to send author timezone missing notification:", { 
              error: replyError.message || replyError.toString(),
              stack: replyError.stack
            });
          }
          return;
        }
        
        // Check for cached time references or extract them from message content
        let timeReferences = global.timeReferenceCache?.get(reaction.message.id);
        if (!timeReferences && reaction.message.content) {
          timeReferences = extractTimeReferences(reaction.message.content);
          
          // Cache the extracted time references if found
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
        
        // Process time references if found
        if (timeReferences && timeReferences.length > 0) {
          logger.debug("Processing clock reaction for time references:", {
            messageId: reaction.message.id,
            references: timeReferences.map(ref => ref.text),
            authorTimezone: messageAuthorTimezone,
            userTimezone: userTimezone
          });
          
          try {
            // Convert each time reference between the two timezones
            const convertedTimes = timeReferences.map(ref => {
              return convertTimeZones(ref, messageAuthorTimezone, userTimezone);
            });
            
            // Format the converted times into a readable message
            const formattedTimes = formatConvertedTimes(convertedTimes);
            const messageContent = `🕒 <@${user.id}>, here are the time conversions:\n\n${formattedTimes}\n\n*This message will self-destruct in 30 seconds.*`;
            
            logger.debug("Attempting to send time conversion message");
            const reply = await reaction.message.channel.send(messageContent)
              .catch(err => {
                logger.error("Error in channel.send():", { 
                  error: err.message || err.toString(),
                  stack: err.stack,
                  channel: reaction.message.channel.id
                });
                return null;
              });
              
            // Set up auto-deletion for the conversion message
            if (reply) {
              logger.debug("Successfully sent time conversion message");
              setTimeout(() => {
                reply.delete().catch(err => 
                  logger.error("Failed to delete time conversion message:", { 
                    error: err.message || err.toString() 
                  })
                );
              }, 30000);
            } else {
              logger.error("Failed to send time conversion message - reply is null");
            }
          } catch (replyError) {
            logger.error("Failed to send reply with time conversions:", { 
              error: replyError.message || replyError.toString(),
              stack: replyError.stack
            });
          }
        } else {
          // Handle case where no time references were found
          logger.debug("No time references found for message:", { messageId: reaction.message.id });
          try {
            const reply = await reaction.message.channel.send(
              `⚠️ <@${user.id}>, I couldn't find any time references in that message. *This message will self-destruct in 15 seconds.*`
            ).catch(err => {
              logger.error("Failed to send no-references message:", { 
                error: err.message || err.toString() 
              });
              return null;
            });
            
            // Set up auto-deletion for the notification
            if (reply) {
              setTimeout(() => {
                reply.delete().catch(err => 
                  logger.error("Failed to delete no-references notification:", { 
                    error: err.message || err.toString() 
                  })
                );
              }, 15000);
            }
          } catch (replyError) {
            logger.error("Failed to send no-references notification:", { 
              error: replyError.message || replyError.toString(),
              stack: replyError.stack
            });
          }
        }
      }
    } catch (error) {
      // Catch-all for any unhandled errors in the event handler
      logger.error("Error processing messageReactionAdd event:", { 
        error: error.message || error.toString(),
        stack: error.stack 
      });
    }
  }
};
