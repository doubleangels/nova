const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { EmbedBuilder } = require('discord.js');
const { getValue, getSpamModeJoinTime, removeSpamModeJoinTime } = require('./database');

/** @type {Map<string, Map<string, Array>>} Map of userId -> normalized content -> message occurrences */
const userMessageTracker = new Map();

/**
 * Normalizes message content for comparison
 * @param {string} content - The message content to normalize
 * @returns {string} Normalized message content
 */
function normalizeContent(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }
  return content.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Checks if a user is considered "new" (within the spam mode tracking window)
 * @param {string} userId - The user ID to check
 * @returns {Promise<{isNew: boolean, timeRemaining: number|null}>} Object indicating if user is new and time remaining in ms
 */
async function isNewUser(userId) {
  try {
    const joinTime = await getSpamModeJoinTime(userId);
    if (!joinTime) {
      return { isNew: false, timeRemaining: null };
    }

    // Get spam mode window, default to mute mode kick time if not set
    let windowHours = parseInt(await getValue('spam_mode_window_hours'), 10);
    if (!windowHours) {
      // Fallback to mute mode kick time
      windowHours = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
    }
    
    const windowMs = windowHours * 60 * 60 * 1000;
    const now = Date.now();
    const joinTimestamp = joinTime.getTime();
    const timeSinceJoin = now - joinTimestamp;
    const timeRemaining = windowMs - timeSinceJoin;

    return {
      isNew: timeRemaining > 0,
      timeRemaining: timeRemaining > 0 ? timeRemaining : null
    };
  } catch (error) {
    logger.error('Error checking if user is new:', {
      error: error.message,
      userId
    });
    return { isNew: false, timeRemaining: null };
  }
}

/**
 * Cleans up old entries for a specific user
 * @param {string} userId - The user ID to clean up
 * @param {number} cutoffTime - Timestamp before which entries should be removed
 */
function cleanupUserEntries(userId, cutoffTime) {
  if (!userMessageTracker.has(userId)) {
    return;
  }

  const userMessages = userMessageTracker.get(userId);
  
  for (const [normalizedContent, occurrences] of userMessages.entries()) {
    // Filter out old occurrences
    const recentOccurrences = occurrences.filter(occ => occ.timestamp > cutoffTime);
    
    if (recentOccurrences.length === 0) {
      // Remove entry if no recent occurrences
      userMessages.delete(normalizedContent);
    } else {
      // Update entry with only recent occurrences
      userMessages.set(normalizedContent, recentOccurrences);
    }
  }

  // Remove user entry if no messages left
  if (userMessages.size === 0) {
    userMessageTracker.delete(userId);
  }
}

/**
 * Tracks a message from a new user and checks for duplicates across channels
 * @param {Object} message - The Discord message object
 * @returns {Promise<void>}
 */
async function trackNewUserMessage(message) {
  try {
    const userId = message.author.id;
    
    // Check if user is new
    const { isNew, timeRemaining } = await isNewUser(userId);
    if (!isNew) {
      // User is not new, skip tracking and remove from database
      logger.debug(`Spam mode: User ${userId} is not new, removing from tracking`);
      await removeSpamModeJoinTime(userId);
      return;
    }

    // Skip if message is too short (less than 3 characters after normalization)
    const normalizedContent = normalizeContent(message.content);
    if (normalizedContent.length < 3) {
      logger.debug(`Spam mode: Message too short (${normalizedContent.length} chars), skipping`);
      return;
    }

    // Get the cutoff time (when user joined + spam mode window)
    const joinTime = await getSpamModeJoinTime(userId);
    if (!joinTime) {
      logger.debug(`Spam mode: User ${userId} not found in spam mode tracking, skipping`);
      return;
    }
    
    logger.debug(`Spam mode: Tracking message for new user ${userId}, content: "${normalizedContent.substring(0, 50)}"`);

    // Get spam mode window, default to mute mode kick time if not set
    let windowHours = parseInt(await getValue('spam_mode_window_hours'), 10);
    if (!windowHours) {
      // Fallback to mute mode kick time
      windowHours = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
    }
    
    const windowMs = windowHours * 60 * 60 * 1000;
    const cutoffTime = joinTime.getTime() + windowMs;
    const now = Date.now();

    // Clean up old entries for this user
    cleanupUserEntries(userId, now - windowMs);

    // Initialize user tracker if needed
    if (!userMessageTracker.has(userId)) {
      userMessageTracker.set(userId, new Map());
    }

    const userMessages = userMessageTracker.get(userId);

    const messageOccurrence = {
      channelId: message.channel.id,
      channelName: message.channel.name,
      timestamp: message.createdTimestamp || Date.now(),
      messageId: message.id
    };

    // Check if this content already exists for this user
    if (userMessages.has(normalizedContent)) {
      const existingOccurrences = userMessages.get(normalizedContent);
      
      // Add this occurrence to the existing entries
      existingOccurrences.push(messageOccurrence);
      userMessages.set(normalizedContent, existingOccurrences);
      
      // Get threshold from database (default: 3)
      const threshold = parseInt(await getValue('spam_mode_threshold'), 10) || 3;
      
      // Log if there are threshold or more occurrences (same or different channels)
      logger.debug(`Spam mode: Found ${existingOccurrences.length} occurrences of message for user ${userId} (threshold: ${threshold})`);
      if (existingOccurrences.length >= threshold) {
        const uniqueChannels = [...new Set(existingOccurrences.map(occ => occ.channelName))];
        const isMultipleChannels = uniqueChannels.length > 1;
        
        logger.warn('[SPAM MODE] New user sent duplicate message:', {
          userId: message.author.id,
          username: message.author.tag,
          content: normalizedContent.substring(0, 100), // Log first 100 chars
          channels: uniqueChannels,
          channelIds: [...new Set(existingOccurrences.map(occ => occ.channelId))],
          occurrenceCount: existingOccurrences.length,
          isMultipleChannels: isMultipleChannels,
          timestamps: existingOccurrences.map(occ => new Date(occ.timestamp).toISOString()),
          messageIds: existingOccurrences.map(occ => occ.messageId),
          timeRemaining: timeRemaining ? `${Math.round(timeRemaining / 1000 / 60)} minutes` : null
        });
        
        // Delete all offending messages
        await deleteOffendingMessages(message.guild, existingOccurrences);
        
        // Post warning to configured channel
        await postSpamWarning(message.guild, message.author, existingOccurrences, normalizedContent);
      }
    } else {
      // First occurrence of this content for this user
      userMessages.set(normalizedContent, [messageOccurrence]);
    }
  } catch (error) {
    logger.error('Error tracking new user message for spam mode:', {
      error: error.message,
      stack: error.stack,
      messageId: message?.id,
      userId: message?.author?.id
    });
  }
}

/**
 * Deletes all offending duplicate messages
 * @param {Guild} guild - The Discord guild
 * @param {Array} occurrences - Array of message occurrences to delete
 * @returns {Promise<void>}
 */
async function deleteOffendingMessages(guild, occurrences) {
  if (!guild) {
    logger.warn('Cannot delete offending messages: no guild provided');
    return;
  }
  
  let deletedCount = 0;
  let failedCount = 0;
  
  for (const occurrence of occurrences) {
    try {
      const channel = await guild.channels.fetch(occurrence.channelId).catch(() => null);
      if (!channel) {
        logger.debug(`Channel ${occurrence.channelId} not found, skipping message deletion`);
        failedCount++;
        continue;
      }
      
      const messageToDelete = await channel.messages.fetch(occurrence.messageId).catch(() => null);
      if (!messageToDelete) {
        logger.debug(`Message ${occurrence.messageId} not found, may have been already deleted`);
        failedCount++;
        continue;
      }
      
      await messageToDelete.delete();
      deletedCount++;
      logger.debug(`Deleted spam message ${occurrence.messageId} from channel ${occurrence.channelName}`);
    } catch (error) {
      logger.warn(`Failed to delete message ${occurrence.messageId} from channel ${occurrence.channelName}:`, {
        error: error.message,
        messageId: occurrence.messageId,
        channelId: occurrence.channelId
      });
      failedCount++;
    }
  }
  
  logger.info(`Deleted ${deletedCount} spam messages (${failedCount} failed)`, {
    totalOccurrences: occurrences.length,
    deletedCount,
    failedCount
  });
}

/**
 * Posts a warning message to the configured warning channel
 * @param {Guild} guild - The Discord guild
 * @param {User} user - The user who sent spam
 * @param {Array} occurrences - Array of message occurrences
 * @param {string} content - The normalized message content
 * @returns {Promise<void>}
 */
async function postSpamWarning(guild, user, occurrences, content) {
  if (!guild) {
    return;
  }
  
  try {
    const warningChannelId = await getValue('spam_mode_warning_channel_id');
    if (!warningChannelId) {
      // No warning channel configured
      return;
    }
    
    const warningChannel = await guild.channels.fetch(warningChannelId).catch(() => null);
    if (!warningChannel) {
      logger.warn(`Warning channel ${warningChannelId} not found in guild ${guild.id}`);
      return;
    }
    
    // Check if bot can send messages in this channel
    if (!warningChannel.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn(`Bot lacks permissions to send messages in warning channel ${warningChannelId}`);
      return;
    }
    
    const uniqueChannels = [...new Set(occurrences.map(occ => occ.channelName))];
    const isMultipleChannels = uniqueChannels.length > 1;
    const channelMentions = uniqueChannels.map(name => `#${name}`).join(', ');
    
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🔤 Spam Detected')
      .addFields(
        { name: 'User', value: `${user} (${user.tag})`, inline: true },
        { name: 'User ID', value: user.id, inline: true },
        { name: 'Occurrences', value: `${occurrences.length}`, inline: true },
        { name: 'Channels', value: channelMentions || 'Unknown', inline: false },
        { name: 'Message Content', value: content.substring(0, 500) || 'No content', inline: false }
      );
    
    if (isMultipleChannels) {
      embed.addFields({
        name: '⚠️ Multiple Channels',
        value: 'This message was sent across multiple channels.',
        inline: false
      });
    }
    
    await warningChannel.send({ 
      embeds: [embed] 
    });
    logger.info(`Posted spam warning to channel ${warningChannel.name} for user ${user.tag}`);
  } catch (error) {
    logger.error('Error posting spam warning:', {
      error: error.message,
      stack: error.stack,
      guildId: guild.id,
      userId: user.id
    });
  }
}

/**
 * Clears all tracked messages (useful for testing or reset)
 */
function clearTracker() {
  userMessageTracker.clear();
  logger.debug('Spam mode message tracker cleared');
}

module.exports = {
  trackNewUserMessage,
  clearTracker
};
