const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember, incrementMessageCount } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { extractTimeReferences } = require('../utils/timeUtils');
const Sentry = require('../sentry');

// We use these configuration constants for message rate limiting and spam detection.
const MESSAGE_RATE_LIMIT = 5; // Maximum messages per time window
const MESSAGE_RATE_WINDOW = 5000; // Time window in milliseconds (5 seconds)
const SPAM_THRESHOLD = 3; // Number of similar messages to trigger spam detection
const SPAM_WINDOW = 10000; // Time window for spam detection (10 seconds)

// We store message history for rate limiting and spam detection.
const messageHistory = new Map();

/**
 * We handle new messages in the server.
 * This function manages message processing and tracking.
 *
 * We perform several tasks for each message:
 * 1. Track message counts for users
 * 2. Handle mute mode verification
 * 3. Process any commands or special message content
 *
 * @param {Message} message - The Discord message object
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

      // Log all bot messages for debugging
      if (message.author.bot) {
        logger.debug("Received bot message:", {
          botName: message.author.tag,
          content: message.content?.substring(0, 100),
          hasEmbeds: !!message.embeds,
          embedCount: message.embeds?.length
        });
      }

      // We skip processing for bot messages except Disboard's bump messages.
      if (message.author.bot && !message.author.tag.toLowerCase().includes('disboard') && !message.author.tag.toLowerCase().includes('nova')) return;

      // We check for rate limiting and spam.
      if (await isRateLimited(message) || await isSpam(message)) {
        return;
      }

      // We log the received message with limited content for privacy reasons.
      logger.debug("Message received:", {
        author: message.author?.tag || "Unknown Author",
        channelId: message.channel.id,
        content: message.content?.substring(0, 50) || "No Content" // We log only first 50 chars for privacy
      });
      
      // We increment the message count for the user.
      await incrementMessageCount(message.author.id, message.author.username);
      logger.debug(`Incremented message count for user ${message.author.tag}`);

      // We check if the user was being tracked in mute mode.
      const wasTracked = await removeTrackedMember(message.author.id);
      if (wasTracked) {
        logger.info(`User ${message.author.tag} sent their first message and was removed from mute tracking.`);
      }

      // We process any commands or special message content.
      if (message.content.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // We handle specific commands here.
        switch (command) {
          case 'ping':
            await message.reply('Pong!');
            break;
          // Add more commands as needed.
        }
      }

      // We process messages from real users, filtering out webhooks and bots.
      await processUserMessage(message);
      
      // We check for bump messages from any source, including bots.
      await checkForBumpMessages(message);

      logger.debug(`Processed message from ${message.author.tag} in ${message.channel.name}`);
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
 * Checks if a message should be rate limited.
 * @param {Message} message - The message to check.
 * @returns {Promise<boolean>} True if the message should be rate limited.
 */
async function isRateLimited(message) {
  const userId = message.author.id;
  const now = Date.now();
  
  if (!messageHistory.has(userId)) {
    messageHistory.set(userId, []);
  }
  
  const userHistory = messageHistory.get(userId);
  
  // We remove old messages from the history.
  while (userHistory.length > 0 && now - userHistory[0] > MESSAGE_RATE_WINDOW) {
    userHistory.shift();
  }
  
  // We check if the user has exceeded the rate limit.
  if (userHistory.length >= MESSAGE_RATE_LIMIT) {
    logger.warn("User rate limited:", {
      userId: message.author.id,
      username: message.author.tag,
      messageCount: userHistory.length
    });
    
    try {
      await message.reply("We're detecting too many messages from you. Please slow down.");
    } catch (error) {
      logger.error("Failed to send rate limit message:", { error });
    }
    
    return true;
  }
  
  // We add the current message to the history.
  userHistory.push(now);
  return false;
}

/**
 * Checks if a message is spam.
 * @param {Message} message - The message to check.
 * @returns {Promise<boolean>} True if the message is spam.
 */
async function isSpam(message) {
  const userId = message.author.id;
  const now = Date.now();
  
  if (!messageHistory.has(userId)) {
    messageHistory.set(userId, []);
  }
  
  const userHistory = messageHistory.get(userId);
  const recentMessages = userHistory.filter(time => now - time <= SPAM_WINDOW);
  
  // We check for similar messages in the recent history.
  const similarMessages = recentMessages.filter(time => {
    const index = userHistory.indexOf(time);
    return index >= 0 && userHistory[index + 1] && 
           Math.abs(userHistory[index + 1] - time) <= 1000; // Messages within 1 second
  });
  
  if (similarMessages.length >= SPAM_THRESHOLD) {
    logger.warn("Spam detected:", {
      userId: message.author.id,
      username: message.author.tag,
      similarMessageCount: similarMessages.length
    });
    
    try {
      await message.reply("We're detecting spam-like behavior. Please stop sending similar messages repeatedly.");
    } catch (error) {
      logger.error("Failed to send spam warning:", { error });
    }
    
    return true;
  }
  
  return false;
}

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
  logger.debug("Checking message for bump:", {
    author: message.author?.tag,
    hasEmbeds: !!message.embeds,
    embedCount: message.embeds?.length,
    content: message.content?.substring(0, 100)
  });

  if (!message.embeds || message.embeds.length === 0) {
    logger.debug("No embeds found in message");
    return;
  }
  
  try {
    // We look for embeds containing the "Bump done!" text that indicates a successful bump.
    const bumpEmbed = message.embeds.find(embed => {
      logger.debug("Checking embed:", {
        description: embed.description?.substring(0, 100),
        hasDescription: !!embed.description
      });
      return embed.description && embed.description.includes("Bump done!");
    });
    
    if (bumpEmbed) {
      logger.info("Bump detected, scheduling reminder");
      // We schedule a 2-hour reminder since that's when the next bump can be done.
      await handleReminder(message, 7200000); // 2 hours = 7200000 milliseconds
      logger.debug("Bump reminder scheduled for 2 hours.");
    } else {
      logger.debug("No bump embed found in message");
    }
  } catch (error) {
    // Add Sentry error tracking
    Sentry.captureException(error, {
      extra: {
        function: 'checkForBumpMessages',
        messageId: message.id
      }
    });
    logger.error("Failed to process bump message:", { 
      error,
      messageId: message.id,
      author: message.author?.tag
    });
  }
}