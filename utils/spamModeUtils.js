const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { EmbedBuilder } = require('discord.js');
const dayjs = require('dayjs');
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
 * Checks if a message contains a GIF (attachment, embed, or gif URL in content)
 * @param {Message} message - The Discord message to check
 * @returns {boolean} True if the message contains a GIF
 */
function messageHasGif(message) {
  // Check attachments for GIF (contentType image/gif or filename/url ends with .gif)
  if (message.attachments && message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      const contentType = (attachment.contentType || '').toLowerCase();
      const name = (attachment.name || '').toLowerCase();
      const url = (attachment.url || '').toLowerCase();
      if (contentType.includes('gif') || name.endsWith('.gif') || url.includes('.gif')) {
        return true;
      }
    }
  }

  // Check embeds for GIF type (Tenor/Giphy etc. show as type 'gif')
  if (message.embeds && message.embeds.size > 0) {
    for (const embed of message.embeds.values()) {
      if (embed.type === 'gif' || (embed.video && embed.video.url && embed.video.url.toLowerCase().includes('.gif'))) {
        return true;
      }
      const url = (embed.url || '').toLowerCase();
      if (url && (url.includes('tenor.com') || url.includes('giphy.com') || url.includes('.gif'))) {
        return true;
      }
    }
  }

  // Check content for common gif link patterns
  const content = (message.content || '').toLowerCase();
  if (content && (content.includes('tenor.com') || content.includes('giphy.com') || /\bhttps?:\/\/[^\s]+\.gif\b/.test(content))) {
    return true;
  }

  return false;
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
    const now = dayjs();
    const joinTimestamp = dayjs(joinTime);
    const timeSinceJoin = now.diff(joinTimestamp);
    const timeRemaining = windowMs - timeSinceJoin;

    return {
      isNew: timeRemaining > 0,
      timeRemaining: timeRemaining > 0 ? timeRemaining : null
    };
  } catch (error) {
    logger.error('Error checking if user is new', {
      err: error,
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
      logger.debug('Spam mode: User is not new, removing from tracking.', {
        userId: userId
      });
      await removeSpamModeJoinTime(userId);
      return;
    }

    // Skip if message is a slash command (starts with "/")
    if (message.content && message.content.trim().startsWith('/')) {
      logger.debug('Spam mode: Message is a slash command, skipping tracking.');
      // Check if user is no longer new before returning
      const { isNew: stillNew } = await isNewUser(userId);
      if (!stillNew) {
        await removeSpamModeJoinTime(userId);
      }
      return;
    }

    // Skip if message contains a GIF (attachment, embed, or gif link in content)
    if (messageHasGif(message)) {
      logger.debug('Spam mode: Message contains GIF, skipping tracking.');
      const { isNew: stillNew } = await isNewUser(userId);
      if (!stillNew) {
        await removeSpamModeJoinTime(userId);
      }
      return;
    }

    // Remove emote patterns from content for tracking: <:name:id> or <a:name:id>
    let contentWithoutEmotes = message.content || '';
    contentWithoutEmotes = contentWithoutEmotes.replace(/<a?:\w+:\d+>/g, '').trim();

    // Skip if message only contains stickers (has stickers but no text content after removing emotes)
    if (message.stickers && message.stickers.size > 0 && contentWithoutEmotes.length === 0) {
      logger.debug('Spam mode: Message only contains stickers, skipping tracking.');
      // Check if user is no longer new before returning
      const { isNew: stillNew } = await isNewUser(userId);
      if (!stillNew) {
        await removeSpamModeJoinTime(userId);
      }
      return;
    }

    // Skip if message only contains emotes (no stickers, no text content after removing emotes)
    if ((!message.stickers || message.stickers.size === 0) && contentWithoutEmotes.length === 0) {
      logger.debug('Spam mode: Message only contains emotes, skipping tracking.');
      // Check if user is no longer new before returning
      const { isNew: stillNew } = await isNewUser(userId);
      if (!stillNew) {
        await removeSpamModeJoinTime(userId);
      }
      return;
    }

    // Skip if message is too short (less than 3 characters after normalization and emote removal)
    const normalizedContent = normalizeContent(contentWithoutEmotes);
    if (normalizedContent.length < 3) {
      logger.debug('Spam mode: Message too short, skipping tracking.');
      // Check if user is no longer new before returning
      const { isNew: stillNew } = await isNewUser(userId);
      if (!stillNew) {
        await removeSpamModeJoinTime(userId);
      }
      return;
    }

    // Only track messages that are sentence-length or longer (not just a few words)
    // Check for at least 5 words OR at least 30 characters
    const wordCount = normalizedContent.split(/\s+/).filter(word => word.length > 0).length;
    const minWords = 5;
    const minChars = 30;
    if (wordCount < minWords && normalizedContent.length < minChars) {
      logger.debug('Spam mode: Message too short (not sentence-length), skipping tracking.', {
        wordCount,
        charCount: normalizedContent.length
      });
      // Check if user is no longer new before returning
      const { isNew: stillNew } = await isNewUser(userId);
      if (!stillNew) {
        await removeSpamModeJoinTime(userId);
      }
      return;
    }

    // Get the cutoff time (when user joined + spam mode window)
    const joinTime = await getSpamModeJoinTime(userId);
    if (!joinTime) {
      logger.debug('Spam mode: User not found in spam mode tracking, skipping.', {
        userId: userId
      });
      return;
    }

    logger.debug('Spam mode: Tracking message for new user.', {
      userId: userId,
      contentPreview: normalizedContent.substring(0, 50)
    });

    // Get spam mode window, default to mute mode kick time if not set
    let windowHours = parseInt(await getValue('spam_mode_window_hours'), 10);
    if (!windowHours) {
      // Fallback to mute mode kick time
      windowHours = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
    }

    const windowMs = windowHours * 60 * 60 * 1000;
    const cutoffTime = dayjs(joinTime).add(windowMs, 'millisecond').valueOf();
    const now = dayjs();

    // Clean up old entries for this user
    cleanupUserEntries(userId, now.subtract(windowMs, 'millisecond').valueOf());

    // Initialize user tracker if needed
    if (!userMessageTracker.has(userId)) {
      userMessageTracker.set(userId, new Map());
    }

    const userMessages = userMessageTracker.get(userId);

    const messageOccurrence = {
      channelId: message.channel.id,
      channelName: message.channel.name,
      timestamp: message.createdTimestamp || dayjs().valueOf(),
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

      // Get spam mode window for the notification message
      let windowHours = parseInt(await getValue('spam_mode_window_hours'), 10);
      if (!windowHours) {
        // Fallback to mute mode kick time
        windowHours = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
      }

      // Log if there are threshold or more occurrences (same or different channels)
      logger.debug('Spam mode: Found occurrences of message for user.', {
        occurrenceCount: existingOccurrences.length,
        userId: userId,
        threshold: threshold
      });
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
          timestamps: existingOccurrences.map(occ => dayjs(occ.timestamp).toISOString()),
          messageIds: existingOccurrences.map(occ => occ.messageId),
          timeRemaining: timeRemaining ? `${Math.round(timeRemaining / 1000 / 60)} minutes` : null
        });

        // Delete all offending messages (including the most recent one)
        const mostRecentChannel = await deleteOffendingMessages(message.guild, existingOccurrences);

        // Send the warning in the channel where the most recent message was
        if (mostRecentChannel) {
          try {
            const channel = await message.guild.channels.fetch(mostRecentChannel.channelId).catch(() => null);
            if (channel) {
              const windowText = windowHours === 1 ? '1 hour' : `${windowHours} hours`;
              const notificationMessage = `⚠️ **Spam Detected**\n\n` +
                `${message.author}, as a new member you are subject to spam monitoring for your first **${windowText}** on the server. ` +
                `Spam tracking is **server-wide**, meaning duplicate messages sent across any channel are monitored. ` +
                `Your duplicate messages have been removed. Please avoid sending the same message multiple times.\n\n` +
                `Thank you for your understanding!`;

              await channel.send(notificationMessage);
            }
          } catch (error) {
            logger.warn('Failed to send spam warning to channel.', {
              err: error,
              channelId: mostRecentChannel.channelId,
              userId: message.author.id
            });
          }
        }

        // Post warning to configured channel
        await postSpamWarning(message.guild, message.author, existingOccurrences, normalizedContent);

        // Timeout the user for 10 minutes
        await timeoutUser(message.guild, message.author, 600);
      }
    } else {
      // First occurrence of this content for this user
      userMessages.set(normalizedContent, [messageOccurrence]);
    }
  } catch (error) {
    logger.error('Error occurred while tracking new user message for spam mode.', {
      err: error,
      messageId: message?.id,
      userId: message?.author?.id
    });
  }
}

/**
 * Deletes all offending duplicate messages (including the most recent one).
 * @param {Guild} guild - The Discord guild
 * @param {Array} occurrences - Array of message occurrences to delete
 * @returns {Promise<{channelId: string, channelName: string}|null>} The channel of the most recent message (for sending the warning), or null
 */
async function deleteOffendingMessages(guild, occurrences) {
  if (!guild) {
    logger.warn('Cannot delete offending messages: no guild provided.');
    return null;
  }

  if (occurrences.length === 0) {
    return null;
  }

  // Sort occurrences by timestamp (most recent last)
  const sortedOccurrences = [...occurrences].sort((a, b) => a.timestamp - b.timestamp);
  const mostRecentOccurrence = sortedOccurrences[sortedOccurrences.length - 1];

  let deletedCount = 0;
  let failedCount = 0;

  // Delete all messages including the most recent one
  for (const occurrence of sortedOccurrences) {
    try {
      const channel = await guild.channels.fetch(occurrence.channelId).catch(() => null);
      if (!channel) {
        logger.debug('Channel not found, skipping message deletion.', {
          channelId: occurrence.channelId
        });
        failedCount++;
        continue;
      }

      const messageToDelete = await channel.messages.fetch(occurrence.messageId).catch(() => null);
      if (!messageToDelete) {
        logger.debug('Message not found, may have been already deleted.', {
          messageId: occurrence.messageId
        });
        failedCount++;
        continue;
      }

      await messageToDelete.delete();
      deletedCount++;
      logger.debug('Deleted spam message from channel.', {
        messageId: occurrence.messageId,
        channelName: occurrence.channelName
      });
    } catch (error) {
      logger.warn('Failed to delete message from channel.', {
        err: error,
        messageId: occurrence.messageId,
        channelId: occurrence.channelId,
        channelName: occurrence.channelName
      });
      failedCount++;
    }
  }

  logger.info('Deleted spam messages.', {
    totalOccurrences: occurrences.length,
    deletedCount,
    failedCount
  });

  return {
    channelId: mostRecentOccurrence.channelId,
    channelName: mostRecentOccurrence.channelName
  };
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
    const warningChannelId = await getValue('spam_mode_channel_id');
    if (!warningChannelId) {
      // No warning channel configured
      return;
    }

    const warningChannel = await guild.channels.fetch(warningChannelId).catch(() => null);
    if (!warningChannel) {
      logger.warn('Warning channel not found in guild.', {
        warningChannelId: warningChannelId,
        guildId: guild.id
      });
      return;
    }

    // Check if bot can send messages in this channel
    if (!warningChannel.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn('Bot lacks permissions to send messages in warning channel.', {
        warningChannelId: warningChannelId
      });
      return;
    }

    const uniqueChannels = [...new Set(occurrences.map(occ => occ.channelName))];
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

    await warningChannel.send({
      embeds: [embed]
    });
    logger.info('Posted spam warning to channel for user.', {
      channelName: warningChannel.name,
      userTag: user.tag
    });
  } catch (error) {
    logger.error('Error occurred while posting spam warning.', {
      err: error,
      guildId: guild.id,
      userId: user.id
    });
  }
}

/**
 * Timeouts a user for a specified duration
 * @param {Guild} guild - The Discord guild
 * @param {User} user - The user to timeout
 * @param {number} durationSeconds - Duration of timeout in seconds
 * @returns {Promise<void>}
 */
async function timeoutUser(guild, user, durationSeconds) {
  if (!guild || !user) {
    logger.warn('Cannot timeout user: missing guild or user.');
    return;
  }

  try {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      logger.warn('Cannot timeout user, member not found in guild.', {
        userId: user.id
      });
      return;
    }

    // Cannot timeout the guild owner (Discord returns Missing Permissions)
    if (guild.ownerId === user.id) {
      logger.warn('Cannot timeout user: user is the server owner.', {
        userId: user.id
      });
      return;
    }

    // Check if bot has permission to timeout members
    const botMember = guild.members.me;
    if (!botMember.permissions.has('ModerateMembers')) {
      logger.warn('Cannot timeout user, bot lacks ModerateMembers permission.', {
        userId: user.id
      });
      return;
    }

    // Check if the user's highest role is higher than bot's highest role
    if (member.roles.highest.position >= botMember.roles.highest.position) {
      logger.warn('Cannot timeout user, user\'s role is higher than or equal to bot\'s role.', {
        userId: user.id
      });
      return;
    }

    // Calculate timeout duration (Discord.js expects a duration in MS)
    const durationMs = Math.floor(Number(durationSeconds) * 1000);

    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      logger.warn('Cannot timeout user: invalid durationSeconds', {
        userId: user.id,
        durationSeconds,
        durationMs
      });
      return;
    }

    // Discord max timeout is 28 days
    const maxMs = 28 * 24 * 60 * 60 * 1000;
    const clampedMs = Math.min(durationMs, maxMs);

    // Validate that the calculated end date will be valid
    const endDate = dayjs().add(clampedMs, 'millisecond');
    if (!endDate.isValid()) {
      logger.warn('Cannot timeout user: invalid calculated end date', {
        userId: user.id,
        durationSeconds,
        clampedMs
      });
      return;
    }

    await member.timeout(clampedMs, 'Spam detected - automatic timeout');

    logger.info('Timed out user due to spam detection.', {
      userTag: user.tag,
      userId: user.id,
      durationSeconds: durationSeconds
    });
  } catch (error) {
    if (error.code === 50013) {
      logger.warn('Could not timeout user: Missing Permissions. Ensure the bot has Moderate Members and that its role is above the user\'s highest role. Server owners cannot be timed out.', {
        userId: user.id,
        guildId: guild.id
      });
    } else {
      logger.error('Error occurred while timing out user.', {
        err: error,
        userId: user.id,
        guildId: guild.id
      });
    }
  }
}

/**
 * Clears a user from the in-memory message tracker (e.g. when removed from watch list).
 * @param {string} userId - The user ID to clear
 */
function clearUserFromSpamTracker(userId) {
  if (userMessageTracker.has(userId)) {
    userMessageTracker.delete(userId);
    logger.debug('Cleared user from spam mode message tracker.', { userId });
  }
}

module.exports = {
  trackNewUserMessage,
  clearUserFromSpamTracker
};
