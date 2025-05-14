const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember, incrementMessageCount } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { extractTimeReferences } = require('../utils/timeUtils');
const Sentry = require('../sentry');

/**
 * Event handler for the 'messageCreate' event.
 * We process incoming messages to perform several important functions:
 *  - We remove users from mute tracking when they send a message.
 *  - We trigger a Disboard reminder when a message embed indicates a bump was done.
 *  - We react with a clock emoji when a message contains time references.
 *  - We track message counts for the yappers leaderboard.
 *
 * @param {Message} message - The message object from Discord.
 */
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    try {
      // We handle partial messages by fetching their full content when needed.
      if (message.partial) {
        try {
          await message.fetch();
        } catch (fetchError) {
          logger.error("Failed to fetch partial message:", { error: fetchError });
          return;
        }
      }

      // We log the received message with limited content for privacy reasons.
      logger.debug("Message received:", {
        author: message.author?.tag || "Unknown Author",
        channelId: message.channel.id,
        content: message.content?.substring(0, 50) || "No Content" // We log only first 50 chars for privacy
      });
      
      // We process messages from real users, filtering out webhooks and bots.
      await processUserMessage(message);
      
      // We check for bump messages from any source, including bots.
      await checkForBumpMessages(message);
    
    } catch (error) {
      // Add Sentry error tracking
      Sentry.captureException(error, {
        extra: {
          event: 'messageCreate',
          messageId: message.id,
          authorId: message.author?.id || 'unknown'
        }
      });
      logger.error("Error processing messageCreate event:", { error });
    }
  }
};

/**
 * Process messages from real users (not webhooks or bots).
 * We handle user verification, time reference detection, and message tracking.
 * 
 * @param {Message} message - The Discord message object.
 */
async function processUserMessage(message) {
  if (message.webhookId || !message.author || message.author.bot) {
    return;
  }
  try {
    // We check if the message author is being tracked for mute mode verification.
    const tracked = await getTrackedMember(message.author.id);
    if (tracked) {
      await removeTrackedMember(message.author.id);
      logger.debug("User removed from mute tracking:", { user: message.author.tag });
    }
    
    // We check if the message contains time references for timezone conversion.
    await processTimeReferences(message);

    // We increment the message count for the user.
    await incrementMessageCount(message.author.id, message.author.tag);
    
  } catch (error) {
    // Add Sentry error tracking
    Sentry.captureException(error, {
      extra: {
        function: 'processUserMessage',
        userId: message.author.id
      }
    });
    logger.error("Error processing user message:", { 
      userId: message.author.id, 
      error 
    });
  }
}

/**
 * Process time references in messages and add clock reactions.
 * We identify time patterns and add a reaction to enable timezone conversion.
 * 
 * @param {Message} message - The Discord message object.
 */
async function processTimeReferences(message) {
  if (!message.content) return;
  
  try {
    // We extract any time references from the message content.
    const timeReferences = extractTimeReferences(message.content);
    if (timeReferences.length > 0) {
      // We store the parsed times in a cache for later reference.
      if (!global.timeReferenceCache) {
        global.timeReferenceCache = new Map();
      }
      global.timeReferenceCache.set(message.id, timeReferences);
      
      // We check if the bot has permission to add reactions before attempting.
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
    }
  } catch (error) {
    // Add Sentry error tracking
    Sentry.captureException(error, {
      extra: {
        function: 'processTimeReferences',
        messageId: message.id
      }
    });
    logger.error("Failed to process time references:", { error });
  }
}

/**
 * Check for bump messages to schedule reminders.
 * We detect server bump confirmations and set up reminders for the next bump.
 * 
 * @param {Message} message - The Discord message object.
 */
async function checkForBumpMessages(message) {
  if (!message.embeds || message.embeds.length === 0) return;
  
  try {
    // We look for embeds containing the "Bump done!" text that indicates a successful bump.
    const bumpEmbed = message.embeds.find(embed =>
      embed.description && embed.description.includes("Bump done!")
    );
    
    if (bumpEmbed) {
      // We schedule a 2-hour reminder since that's when the next bump can be done.
      await handleReminder(message, 7200000); // 2 hours = 7200000 milliseconds
      logger.debug("Bump reminder scheduled for 2 hours.");
    }
  } catch (error) {
    // Add Sentry error tracking
    Sentry.captureException(error, {
      extra: {
        function: 'checkForBumpMessages',
        messageId: message.id
      }
    });
    logger.error("Failed to process bump message:", { error });
  }
}