const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { getTrackedMember, removeTrackedMember, incrementMessageCount, incrementChannelMessageCount } = require('../utils/database');
const { handleReminder } = require('../utils/reminderUtils');
const { extractTimeReferences } = require('../utils/timeUtils');
const Sentry = require('../sentry');

// We handle new messages and process them according to our rules.
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    try {
      // We fetch full content for partial messages to ensure complete processing.
      if (message.partial) {
        try {
          await message.fetch();
        } catch (fetchError) {
          logger.error("Failed to fetch partial message:", { error: fetchError });
          return;
        }
      }

      // We log bot messages for debugging purposes.
      if (message.author.bot) {
        logger.debug("Received bot message:", {
          botName: message.author.tag,
          content: message.content?.substring(0, 100),
          hasEmbeds: !!message.embeds,
          embedCount: message.embeds?.length
        });
      }

      // We skip non-Disboard/Nova bot messages to focus on relevant interactions.
      if (message.author.bot && !message.author.tag.toLowerCase().includes('disboard') && !message.author.tag.toLowerCase().includes('nova')) return;

      // We log received messages for monitoring and debugging.
      logger.debug("Message received:", {
        author: message.author?.tag || "Unknown Author",
        channelId: message.channel.id,
        content: message.content?.substring(0, 50) || "No Content"
      });
      
      // We increment user message count only for non-bot messages.
      if (!message.author.bot) {
        await incrementMessageCount(message.author.id, message.author.username);
        logger.debug(`Incremented message count for user ${message.author.tag}.`);
      }

      // We remove users from mute tracking when they send their first message.
      const wasTracked = await removeTrackedMember(message.author.id);
      if (wasTracked) {
        logger.info(`User ${message.author.tag} sent their first message and was removed from mute tracking.`);
      }

      // We handle simple prefix commands for basic bot interactions.
      if (message.content.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        switch (command) {
          case 'ping':
            await message.reply('Pong!');
            break;
        }
      }

      // We process user messages and handle various features.
      await processUserMessage(message);
      // We check for bump messages to maintain server visibility.
      await checkForBumpMessages(message);
      // We increment per-channel message count for non-bot messages.
      if (message.channel && message.channel.type === 0 && !message.author.bot) {
        await incrementChannelMessageCount(message.channel.id, message.channel.name);
      }
      logger.debug(`Processed message from ${message.author.tag} in ${message.channel.name}.`);
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

/**
 * We process messages from regular users (not webhooks or bots).
 * This function handles user message tracking and feature processing.
 * 
 * @param {Message} message - The Discord message object.
 */
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

/**
 * We process time references found in user messages.
 * This function identifies and marks messages containing time expressions.
 * 
 * @param {Message} message - The Discord message object.
 */
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

/**
 * We check for bump messages to maintain server visibility.
 * This function identifies successful server bumps and schedules reminders.
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