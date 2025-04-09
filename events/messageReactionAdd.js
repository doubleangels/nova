// events/messageReactionAdd.js
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getUserTimezone } = require('../utils/database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Configure Day.js with the necessary plugins
dayjs.extend(utc);
dayjs.extend(timezone);

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
        // Get the user's timezone from the database (User 2 - the reactor)
        const userTimezone = await getUserTimezone(user.id);
        
        if (!userTimezone) {
          logger.debug("User has no timezone set:", { userId: user.id });
          try {
            // Reply with a temporary message that pings the user
            const reply = await reaction.message.channel.send(
              `<@${user.id}>, you haven't set your timezone yet. Please use the \`/timezone set\` command to set your timezone.`
            ).catch(err => {
              logger.error("Failed to send timezone reminder message:", { 
                error: err.message || err.toString(),
                stack: err.stack
              });
              return null;
            });
            
            // Delete the message after 30 seconds if it was sent successfully
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
        
        // Get the message author's timezone from the database (User 1 - the original poster)
        const messageAuthorId = reaction.message.author.id;
        const messageAuthorTimezone = await getUserTimezone(messageAuthorId);
        
        if (!messageAuthorTimezone) {
          logger.debug("Message author has no timezone set:", { authorId: messageAuthorId });
          try {
            // Reply with a temporary message that pings the user
            const reply = await reaction.message.channel.send(
              `<@${user.id}>, the author of that message hasn't set their timezone yet, so I can't convert the time accurately.`
            ).catch(err => {
              logger.error("Failed to send author timezone missing message:", { 
                error: err.message || err.toString(),
                stack: err.stack
              });
              return null;
            });
            
            // Delete the message after 30 seconds if it was sent successfully
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
            authorTimezone: messageAuthorTimezone,
            userTimezone: userTimezone
          });
          
          try {
            // Convert time from author's timezone to user's timezone
            const convertTimeToUserTimezone = (timeRef, authorTimezone, userTimezone) => {
              // Extract the time from the reference
              const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/;
              const match = timeRef.text.match(timeRegex);
              
              if (!match) {
                return {
                  text: timeRef.text,
                  originalTime: null,
                  convertedTime: "Could not parse time",
                  fromTimezone: authorTimezone,
                  toTimezone: userTimezone
                };
              }
              
              // Extract hours, minutes, and am/pm
              let hours = parseInt(match[1], 10);
              const minutes = match[2] ? parseInt(match[2], 10) : 0;
              const ampm = match[3] ? match[3].toLowerCase() : null;
              
              // Adjust hours for 12-hour format if am/pm is specified
              if (ampm === 'pm' && hours < 12) {
                hours += 12;
              } else if (ampm === 'am' && hours === 12) {
                hours = 0;
              }
              
              // Get the current date in the author's timezone
              const now = dayjs().tz(authorTimezone);
              
              // Create a Day.js object with the specified time in the author's timezone
              const timeInAuthorTZ = now.hour(hours).minute(minutes).second(0);
              
              // Convert to the user's timezone
              const timeInUserTZ = timeInAuthorTZ.tz(userTimezone);
              
              // Format the times
              const originalTimeFormatted = timeInAuthorTZ.format('h:mm A');
              const convertedTimeFormatted = timeInUserTZ.format('h:mm A');
              
              return {
                text: timeRef.text,
                originalTime: originalTimeFormatted,
                convertedTime: convertedTimeFormatted,
                fromTimezone: authorTimezone,
                toTimezone: userTimezone
              };
            };
            
            // Convert each time reference
            const convertedTimes = timeReferences.map(ref => {
              return convertTimeToUserTimezone(ref, messageAuthorTimezone, userTimezone);
            });
            
            // Format the converted times for display
            const formatTimeReferences = (convertedTimes) => {
              return convertedTimes.map(conversion => {
                const { text, originalTime, convertedTime, fromTimezone, toTimezone } = conversion;
                if (originalTime) {
                  return `"${text}": ${originalTime} (${fromTimezone}) → ${convertedTime} (${toTimezone})`;
                } else {
                  return `"${text}": ${convertedTime}`;
                }
              }).join('\n');
            };
            
            // Format the converted times
            const formattedTimes = formatTimeReferences(convertedTimes);
            
            // Create a message with the time conversions that pings the user
            const messageContent = `<@${user.id}>, here are the time conversions:\n\n${formattedTimes}\n\n*This message will self-destruct in 30 seconds.*`;
            
            // Send a temporary reply in the channel with better error handling
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
            
            // Delete the message after 30 seconds if it was sent successfully
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
          logger.debug("No time references found for message:", { messageId: reaction.message.id });
          
          // Notify the user that no time references were found with a ping
          try {
            const reply = await reaction.message.channel.send(
              `<@${user.id}>, I couldn't find any time references in that message. *This message will self-destruct in 15 seconds.*`
            ).catch(err => {
              logger.error("Failed to send no-references message:", { 
                error: err.message || err.toString() 
              });
              return null;
            });
            
            // Delete the message after 15 seconds if it was sent successfully
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
      logger.error("Error processing messageReactionAdd event:", { 
        error: error.message || error.toString(),
        stack: error.stack 
      });
    }
  }
};
