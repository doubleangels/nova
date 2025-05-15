const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember, incrementMessageCount, incrementChannelMessageCount } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { extractTimeReferences } = require('../utils/timeUtils');
const Sentry = require('../sentry');

// Message rate limiting and spam detection constants
const MESSAGE_RATE_LIMIT = 5;
const MESSAGE_RATE_WINDOW = 5000;
const SPAM_THRESHOLD = 3;
const SPAM_WINDOW = 10000;

// In-memory message history for rate limiting and spam
const messageHistory = new Map();

// Handle new messages
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    try {
      // Fetch full content for partial messages
      if (message.partial) {
        try {
          await message.fetch();
        } catch (fetchError) {
          logger.error("Failed to fetch partial message:", { error: fetchError });
          return;
        }
      }

      // Log bot messages for debugging
      if (message.author.bot) {
        logger.debug("Received bot message:", {
          botName: message.author.tag,
          content: message.content?.substring(0, 100),
          hasEmbeds: !!message.embeds,
          embedCount: message.embeds?.length
        });
      }

      // Skip non-Disboard/Nova bot messages
      if (message.author.bot && !message.author.tag.toLowerCase().includes('disboard') && !message.author.tag.toLowerCase().includes('nova')) return;

      // Rate limit and spam check
      if (await isRateLimited(message) || await isSpam(message)) return;

      // Log received message
      logger.debug("Message received:", {
        author: message.author?.tag || "Unknown Author",
        channelId: message.channel.id,
        content: message.content?.substring(0, 50) || "No Content"
      });
      
      // Increment user message count only for non-bot messages
      if (!message.author.bot) {
        await incrementMessageCount(message.author.id, message.author.username);
        logger.debug(`Incremented message count for user ${message.author.tag}`);
      }

      // Remove from mute tracking if needed
      const wasTracked = await removeTrackedMember(message.author.id);
      if (wasTracked) {
        logger.info(`User ${message.author.tag} sent their first message and was removed from mute tracking.`);
      }

      // Handle simple prefix commands
      if (message.content.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        switch (command) {
          case 'ping':
            await message.reply('Pong!');
            break;
        }
      }

      // Process user messages
      await processUserMessage(message);
      // Check for bump messages
      await checkForBumpMessages(message);
      // Increment per-channel message count only for non-bot messages
      if (message.channel && message.channel.type === 0 && !message.author.bot) {
        await incrementChannelMessageCount(message.channel.id, message.channel.name);
      }
      logger.debug(`Processed message from ${message.author.tag} in ${message.channel.name}`);
    } catch (error) {
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

// Rate limiting helper
async function isRateLimited(message) {
  const userId = message.author.id;
  const now = Date.now();
  if (!messageHistory.has(userId)) messageHistory.set(userId, []);
  const userHistory = messageHistory.get(userId);
  while (userHistory.length > 0 && now - userHistory[0] > MESSAGE_RATE_WINDOW) userHistory.shift();
  if (userHistory.length >= MESSAGE_RATE_LIMIT) {
    logger.warn("User rate limited:", {
      userId: message.author.id,
      username: message.author.tag,
      messageCount: userHistory.length
    });
    try { await message.reply("We're detecting too many messages from you. Please slow down."); } catch (error) { logger.error("Failed to send rate limit message:", { error }); }
    return true;
  }
  userHistory.push(now);
  return false;
}

// Spam detection helper
async function isSpam(message) {
  const userId = message.author.id;
  const now = Date.now();
  if (!messageHistory.has(userId)) messageHistory.set(userId, []);
  const userHistory = messageHistory.get(userId);
  const recentMessages = userHistory.filter(time => now - time <= SPAM_WINDOW);
  const similarMessages = recentMessages.filter(time => {
    const index = userHistory.indexOf(time);
    return index >= 0 && userHistory[index + 1] && Math.abs(userHistory[index + 1] - time) <= 1000;
  });
  if (similarMessages.length >= SPAM_THRESHOLD) {
    logger.warn("Spam detected:", {
      userId: message.author.id,
      username: message.author.tag,
      similarMessageCount: similarMessages.length
    });
    try { await message.reply("We're detecting spam-like behavior. Please stop sending similar messages repeatedly."); } catch (error) { logger.error("Failed to send spam warning:", { error }); }
    return true;
  }
  return false;
}

// Process user messages (not webhooks or bots)
async function processUserMessage(message) {
  if (message.webhookId || !message.author || message.author.bot) return;
  try {
    const tracked = await getTrackedMember(message.author.id);
    if (tracked) {
      await removeTrackedMember(message.author.id);
      logger.debug("User removed from mute tracking:", { user: message.author.tag });
    }
    await processTimeReferences(message);
    await incrementMessageCount(message.author.id, message.author.tag);
  } catch (error) {
    Sentry.captureException(error, {
      extra: { function: 'processUserMessage', userId: message.author.id }
    });
    logger.error("Error processing user message:", { userId: message.author.id, error });
  }
}

// Process time references in messages
async function processTimeReferences(message) {
  if (!message.content) return;
  try {
    const timeReferences = extractTimeReferences(message.content);
    if (timeReferences.length > 0) {
      if (!global.timeReferenceCache) global.timeReferenceCache = new Map();
      global.timeReferenceCache.set(message.id, timeReferences);
      if (message.guild && message.channel.permissionsFor(message.guild.members.me).has('AddReactions')) {
        await message.react('🕒');
        logger.debug("Added clock reaction to message with time reference:", { messageId: message.id, references: timeReferences.map(ref => ref.text) });
      } else {
        logger.warn("Missing permission to add reactions in channel:", { channelId: message.channel.id });
      }
    }
  } catch (error) {
    Sentry.captureException(error, { extra: { function: 'processTimeReferences', messageId: message.id } });
    logger.error("Failed to process time references:", { error });
  }
}

// Check for bump messages to schedule reminders
async function checkForBumpMessages(message) {
  logger.debug("Checking message for bump:", {
    author: message.author?.tag,
    hasEmbeds: !!message.embeds,
    embedCount: message.embeds?.length,
    content: message.content?.substring(0, 100)
  });
  if (!message.embeds || message.embeds.length === 0) return;
  try {
    const bumpEmbed = message.embeds.find(embed => {
      logger.debug("Checking embed:", { description: embed.description?.substring(0, 100), hasDescription: !!embed.description });
      return embed.description && embed.description.includes("Bump done!");
    });
    if (bumpEmbed) {
      logger.info("Bump detected, scheduling reminder");
      await handleReminder(message, 7200000);
      logger.debug("Bump reminder scheduled for 2 hours.");
    }
  } catch (error) {
    Sentry.captureException(error, { extra: { function: 'checkForBumpMessages', messageId: message.id } });
    logger.error("Failed to process bump message:", { error, messageId: message.id, author: message.author?.tag });
  }
}