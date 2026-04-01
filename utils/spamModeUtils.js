const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const { EmbedBuilder } = require('discord.js');
const dayjs = require('dayjs');
const { getValue, getSpamModeJoinTime, removeSpamModeJoinTime } = require('./database');

// ── In-memory tracking stores ─────────────────────────────────────────────────

/** @type {Map<string, Map<string, Array>>} userId -> normalizedContent -> message occurrences */
const userMessageTracker = new Map();

/** @type {Map<string, number[]>} userId -> array of recent message timestamps (flood detection) */
const userFloodTracker = new Map();

// ── Detection constants ───────────────────────────────────────────────────────

/** Number of messages within the flood window to trigger a flood alert */
const FLOOD_MESSAGE_COUNT = 6;

/** Flood detection window in milliseconds (30 seconds) */
const FLOOD_WINDOW_MS = 30_000;

/** Levenshtein similarity ratio above which two messages are treated as duplicates */
const SIMILARITY_THRESHOLD = 0.85;

/** Reduce the base threshold by this amount when spam spans multiple channels */
const MULTI_CHANNEL_THRESHOLD_REDUCTION = 1;

/** Reduce the base threshold by this amount when the message contains a link/invite */
const LINK_THRESHOLD_REDUCTION = 1;

/** Maximum string length fed into the Levenshtein matcher (performance guard) */
const MAX_SIMILARITY_LENGTH = 300;

/** Patterns that mark a message as containing a link regardless of length */
const DISCORD_INVITE_PATTERN = /discord(?:\.gg|\.com\/invite|app\.com\/invite)\/[a-zA-Z0-9-]+/i;
const URL_PATTERN = /https?:\/\/\S+/i;

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Normalizes message content for comparison.
 * @param {string} content
 * @returns {string}
 */
function normalizeContent(content) {
  if (!content || typeof content !== 'string') return '';
  return content.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * Uses a space-optimised two-row DP (O(min(m,n)) space).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Keep `a` as the shorter string to minimise memory
  if (a.length > b.length) [a, b] = [b, a];

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/**
 * Returns a similarity score in [0, 1] between two strings.
 * 1.0 = identical, 0.0 = completely different.
 * Both strings are capped at MAX_SIMILARITY_LENGTH before comparison.
 * @param {string} str1
 * @param {string} str2
 * @returns {number}
 */
function similarityScore(str1, str2) {
  const a = str1.slice(0, MAX_SIMILARITY_LENGTH);
  const b = str2.slice(0, MAX_SIMILARITY_LENGTH);
  if (a === b) return 1.0;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

/**
 * Searches a user's tracked messages for a key that is sufficiently similar
 * to the given normalizedContent. Returns the matching key, or null.
 * @param {Map<string, Array>} userMessages
 * @param {string} normalizedContent
 * @returns {string|null}
 */
function findSimilarContent(userMessages, normalizedContent) {
  for (const [key] of userMessages.entries()) {
    if (similarityScore(key, normalizedContent) >= SIMILARITY_THRESHOLD) {
      return key;
    }
  }
  return null;
}

/**
 * Returns true if the content contains a Discord invite link or any HTTP URL.
 * @param {string} content
 * @returns {boolean}
 */
function containsLink(content) {
  return DISCORD_INVITE_PATTERN.test(content) || URL_PATTERN.test(content);
}

/**
 * Records a message timestamp for flood/velocity detection.
 * Returns true if the user has hit the flood threshold within the window.
 * @param {string} userId
 * @param {number} timestamp - Unix millisecond timestamp
 * @returns {boolean}
 */
function checkFlood(userId, timestamp) {
  const windowStart = timestamp - FLOOD_WINDOW_MS;
  if (!userFloodTracker.has(userId)) userFloodTracker.set(userId, []);

  const recent = userFloodTracker.get(userId).filter(t => t > windowStart);
  recent.push(timestamp);
  userFloodTracker.set(userId, recent);

  return recent.length >= FLOOD_MESSAGE_COUNT;
}

// ── Core user-state helpers ───────────────────────────────────────────────────

/**
 * Checks if a user is still within the spam-mode tracking window.
 * @param {string} userId
 * @returns {Promise<{isNew: boolean, timeRemaining: number|null}>}
 */
async function isNewUser(userId) {
  try {
    const joinTime = await getSpamModeJoinTime(userId);
    if (!joinTime) return { isNew: false, timeRemaining: null };

    let windowHours = parseInt(await getValue('spam_mode_window_hours'), 10);
    if (!windowHours) windowHours = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;

    const windowMs = windowHours * 60 * 60 * 1000;
    const timeSinceJoin = dayjs().diff(dayjs(joinTime));
    const timeRemaining = windowMs - timeSinceJoin;

    return {
      isNew: timeRemaining > 0,
      timeRemaining: timeRemaining > 0 ? timeRemaining : null
    };
  } catch (error) {
    logger.error('Error checking if user is new', { err: error, userId });
    return { isNew: false, timeRemaining: null };
  }
}

/**
 * Removes stale message occurrences from in-memory tracking for one user.
 * @param {string} userId
 * @param {number} cutoffTime - Remove occurrences older than this timestamp
 */
function cleanupUserEntries(userId, cutoffTime) {
  if (!userMessageTracker.has(userId)) return;
  const userMessages = userMessageTracker.get(userId);

  for (const [key, occurrences] of userMessages.entries()) {
    const recent = occurrences.filter(occ => occ.timestamp > cutoffTime);
    if (recent.length === 0) {
      userMessages.delete(key);
    } else {
      userMessages.set(key, recent);
    }
  }

  if (userMessages.size === 0) userMessageTracker.delete(userId);
}

// ── Main tracking entry point ─────────────────────────────────────────────────

/**
 * Tracks a message from a new user and checks for spam patterns:
 *  - Message flood / velocity (≥6 messages in 30 s)
 *  - Duplicate or similar content (Levenshtein ≥85%)
 *  - Link / Discord invite spam (bypasses length filter, lower threshold)
 *  - Cross-channel spam (lower threshold when channels differ)
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<void>}
 */
async function trackNewUserMessage(message) {
  try {
    const userId = message.author.id;

    // ── Is this user still in the new-user window? ────────────────────────
    const { isNew, timeRemaining } = await isNewUser(userId);
    if (!isNew) {
      logger.debug('Spam mode: User is not new, removing from tracking.', { userId });
      await removeSpamModeJoinTime(userId);
      userFloodTracker.delete(userId);
      return;
    }

    // Skip slash commands
    if (message.content?.trim().startsWith('/')) {
      logger.debug('Spam mode: Message is a slash command, skipping tracking.');
      return;
    }

    const messageTimestamp = message.createdTimestamp || dayjs().valueOf();

    // ── Flood / velocity check ────────────────────────────────────────────
    const isFlooding = checkFlood(userId, messageTimestamp);
    if (isFlooding) {
      logger.warn('[SPAM MODE] New user exceeded message velocity threshold (flood).', {
        userId,
        username: message.author.tag,
        floodCount: FLOOD_MESSAGE_COUNT,
        windowMs: FLOOD_WINDOW_MS
      });

      const floodOccurrence = [{
        channelId: message.channel.id,
        channelName: message.channel.name,
        timestamp: messageTimestamp,
        messageId: message.id
      }];

      // Try to DM the user about the flood before timing them out
      let floodDmSent = false;
      try {
        await message.author.send(
          `⚠️ **Spam Detected — Message Flood**\n\n` +
          `You have been sending messages too quickly. You have been automatically timed out for **10 minutes**.\n\n` +
          `Please slow down and read existing messages before sending new ones. Thank you!`
        );
        floodDmSent = true;
        logger.debug('Sent flood-detection DM to user.', { userId });
      } catch (dmErr) {
        logger.debug('Could not DM user about flood detection (DMs may be disabled).', { err: dmErr, userId });
      }

      // Warn mods and timeout the user
      await postSpamWarning(message.guild, message.author, floodOccurrence, '[message flood — velocity limit exceeded]', floodDmSent);
      await timeoutUser(message.guild, message.author, 600);

      // Reset flood tracker so repeated floods each get their own timeout
      userFloodTracker.delete(userId);
      return;
    }

    // ── Strip custom emotes from content ─────────────────────────────────
    let contentWithoutEmotes = (message.content || '').replace(/<a?:\w+:\d+>/g, '').trim();

    // Skip sticker-only messages
    if (message.stickers?.size > 0 && contentWithoutEmotes.length === 0) {
      logger.debug('Spam mode: Message only contains stickers, skipping tracking.');
      return;
    }

    // Skip emote-only messages
    if ((!message.stickers || message.stickers.size === 0) && contentWithoutEmotes.length === 0) {
      logger.debug('Spam mode: Message only contains emotes, skipping tracking.');
      return;
    }

    // ── Link / invite detection ───────────────────────────────────────────
    // Messages containing links bypass the length/word-count filter entirely
    // because short invite links are common spam even when they look "small".
    const hasLink = containsLink(contentWithoutEmotes);

    if (!hasLink) {
      // Apply normal length filters only to non-link messages
      if (contentWithoutEmotes.length < 3) {
        logger.debug('Spam mode: Message too short (pre-normalization), skipping tracking.');
        return;
      }

      const tentativeNorm = normalizeContent(contentWithoutEmotes);
      if (tentativeNorm.length < 3) {
        logger.debug('Spam mode: Message too short (post-normalization), skipping tracking.');
        return;
      }

      const wordCount = tentativeNorm.split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount < 5 && tentativeNorm.length < 30) {
        logger.debug('Spam mode: Message too short (not sentence-length), skipping tracking.', {
          wordCount,
          charCount: tentativeNorm.length
        });
        return;
      }
    }

    const normalizedContent = normalizeContent(contentWithoutEmotes);
    if (normalizedContent.length === 0) return;

    // ── Fetch user's join time and window config ──────────────────────────
    const joinTime = await getSpamModeJoinTime(userId);
    if (!joinTime) {
      logger.debug('Spam mode: User not found in spam mode tracking, skipping.', { userId });
      return;
    }

    let windowHours = parseInt(await getValue('spam_mode_window_hours'), 10);
    if (!windowHours) windowHours = parseInt(await getValue('mute_mode_kick_time_hours'), 10) || 4;
    const windowMs = windowHours * 60 * 60 * 1000;

    // Base threshold from config (default: 3)
    const baseThreshold = parseInt(await getValue('spam_mode_threshold'), 10) || 3;

    // ── Clean up stale in-memory entries ─────────────────────────────────
    const now = dayjs();
    cleanupUserEntries(userId, now.subtract(windowMs, 'millisecond').valueOf());

    if (!userMessageTracker.has(userId)) userMessageTracker.set(userId, new Map());
    const userMessages = userMessageTracker.get(userId);

    // ── Find exact or similar existing tracking key ───────────────────────
    // Similarity matching catches near-duplicate messages that vary slightly
    // (different punctuation, extra spaces, minor word swaps, etc.)
    const exactKey = userMessages.has(normalizedContent) ? normalizedContent : null;
    const similarKey = exactKey ? null : findSimilarContent(userMessages, normalizedContent);
    const trackingKey = exactKey ?? similarKey ?? normalizedContent;
    const isSimilarMatch = !!similarKey;

    const messageOccurrence = {
      channelId: message.channel.id,
      channelName: message.channel.name,
      timestamp: messageTimestamp,
      messageId: message.id
    };

    logger.debug('Spam mode: Tracking message for new user.', {
      userId,
      contentPreview: normalizedContent.substring(0, 50),
      hasLink,
      isSimilarMatch,
      trackingKey: trackingKey.substring(0, 50)
    });

    if (userMessages.has(trackingKey)) {
      const existingOccurrences = userMessages.get(trackingKey);
      existingOccurrences.push(messageOccurrence);
      userMessages.set(trackingKey, existingOccurrences);

      // ── Dynamic threshold ─────────────────────────────────────────────
      // Reduce the threshold by 1 for each risk factor present:
      //   • Cross-channel spread: stronger spam signal
      //   • Contains a link/invite: very common in server-ad spam
      // Floor at 2 so we never act on just 1 message.
      const uniqueChannelIds = [...new Set(existingOccurrences.map(occ => occ.channelId))];
      const isMultiChannel = uniqueChannelIds.length > 1;

      let effectiveThreshold = baseThreshold;
      if (isMultiChannel) effectiveThreshold -= MULTI_CHANNEL_THRESHOLD_REDUCTION;
      if (hasLink)        effectiveThreshold -= LINK_THRESHOLD_REDUCTION;
      effectiveThreshold = Math.max(2, effectiveThreshold);

      logger.debug('Spam mode: Found occurrences of message for user.', {
        occurrenceCount: existingOccurrences.length,
        effectiveThreshold,
        isMultiChannel,
        hasLink,
        isSimilarMatch,
        userId
      });

      if (existingOccurrences.length >= effectiveThreshold) {
        const uniqueChannelNames = [...new Set(existingOccurrences.map(occ => occ.channelName))];

        logger.warn('[SPAM MODE] New user sent duplicate/similar message:', {
          userId: message.author.id,
          username: message.author.tag,
          content: normalizedContent.substring(0, 100),
          channels: uniqueChannelNames,
          channelIds: uniqueChannelIds,
          occurrenceCount: existingOccurrences.length,
          effectiveThreshold,
          isMultiChannel,
          hasLink,
          isSimilarMatch,
          timeRemaining: timeRemaining ? `${Math.round(timeRemaining / 1000 / 60)} minutes` : null
        });

        // Delete all spam copies (older ones first, then the most recent)
        const mostRecentMessage = await deleteOffendingMessages(message.guild, existingOccurrences);

        // Try to DM the user privately rather than posting a public reply.
        // Users with DMs disabled will simply not receive the message — mods
        // can see whether it reached them via the alert embed.
        let dmSent = false;
        try {
          const windowText = windowHours === 1 ? '1 hour' : `${windowHours} hours`;
          const notificationMessage =
            `⚠️ **Spam Detected**\n\n` +
            `As a new member, you are subject to spam monitoring for your first **${windowText}** on the server. ` +
            `Spam tracking is **server-wide**, meaning duplicate or very similar messages sent across any channel are monitored. ` +
            `Your duplicate messages have been removed. Please avoid sending the same message multiple times.\n\n` +
            `Thank you for your understanding!`;

          await message.author.send(notificationMessage);
          dmSent = true;
          logger.debug('Sent spam-detection DM to user.', { userId });
        } catch (dmErr) {
          logger.debug('Could not DM user about spam detection (DMs may be disabled).', { err: dmErr, userId });
        }

        // Delete the most-recent copy now that we no longer need to reply to it
        if (mostRecentMessage) {
          await mostRecentMessage.delete().catch(err => {
            logger.debug('Could not delete most-recent spam message (may already be gone).', {
              err,
              messageId: mostRecentMessage.id
            });
          });
        }

        // Notify mods (with DM status) and apply timeout
        await postSpamWarning(message.guild, message.author, existingOccurrences, normalizedContent, dmSent);
        await timeoutUser(message.guild, message.author, 600);

        // Remove this specific content key so future messages aren't caught
        // by stale data; they'll be re-evaluated fresh.
        userMessages.delete(trackingKey);
      }
    } else {
      // First occurrence of this content (or similar group) for this user
      userMessages.set(trackingKey, [messageOccurrence]);
    }
  } catch (error) {
    logger.error('Error occurred while tracking new user message for spam mode.', {
      err: error,
      messageId: message?.id,
      userId: message?.author?.id
    });
  }
}

// ── Action helpers ────────────────────────────────────────────────────────────

/**
 * Deletes all offending duplicate messages except the most recent one.
 * @param {import('discord.js').Guild} guild
 * @param {Array} occurrences
 * @returns {Promise<import('discord.js').Message|null>} The most recent message, or null
 */
async function deleteOffendingMessages(guild, occurrences) {
  if (!guild || occurrences.length === 0) return null;

  // Sort oldest → newest; keep the last one to reply to
  const sorted = [...occurrences].sort((a, b) => a.timestamp - b.timestamp);
  const mostRecentOccurrence = sorted[sorted.length - 1];
  const toDelete = sorted.slice(0, -1);

  let deletedCount = 0;
  let failedCount = 0;

  for (const occurrence of toDelete) {
    try {
      const channel = await guild.channels.fetch(occurrence.channelId).catch(() => null);
      if (!channel) { failedCount++; continue; }

      const msg = await channel.messages.fetch(occurrence.messageId).catch(() => null);
      if (!msg) { failedCount++; continue; }

      await msg.delete();
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

  // Fetch the most-recent message so the caller can reply to it
  let mostRecentMessage = null;
  try {
    const channel = await guild.channels.fetch(mostRecentOccurrence.channelId).catch(() => null);
    if (channel) {
      mostRecentMessage = await channel.messages.fetch(mostRecentOccurrence.messageId).catch(() => null);
    }
  } catch (error) {
    logger.warn('Failed to fetch most recent message.', {
      err: error,
      messageId: mostRecentOccurrence.messageId
    });
  }

  logger.info('Deleted earlier spam messages; most recent kept for reply.', {
    totalOccurrences: occurrences.length,
    deletedCount,
    failedCount,
    mostRecentMessageId: mostRecentOccurrence.messageId
  });

  return mostRecentMessage;
}

/**
 * Posts a mod-channel warning embed when spam is detected.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user
 * @param {Array} occurrences
 * @param {string} content - Normalized message content (or label for flood)
 * @returns {Promise<void>}
 */
/**
 * @param {boolean} dmSent - Whether a DM notification was successfully sent to the user.
 */
async function postSpamWarning(guild, user, occurrences, content, dmSent = false) {
  if (!guild) return;

  try {
    const warningChannelId = await getValue('spam_mode_channel_id');
    if (!warningChannelId) return;

    const warningChannel = await guild.channels.fetch(warningChannelId).catch(() => null);
    if (!warningChannel) {
      logger.warn('Warning channel not found in guild.', { warningChannelId, guildId: guild.id });
      return;
    }

    if (!warningChannel.permissionsFor(guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn('Bot lacks permissions to send messages in warning channel.', { warningChannelId });
      return;
    }

    const uniqueChannels = [...new Set(occurrences.map(occ => occ.channelName))];
    const channelMentions = uniqueChannels.map(name => `#${name}`).join(', ');

    const dmStatusValue = dmSent ? '✅ Sent' : '❌ Failed';

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🔤 Spam Detected')
      .addFields(
        { name: 'User', value: `${user} (${user.tag})`, inline: true },
        { name: 'User ID', value: user.id, inline: true },
        { name: 'DM Notification', value: dmStatusValue, inline: true },
        { name: 'Occurrences', value: `${occurrences.length}`, inline: true },
        { name: 'Channels', value: channelMentions || 'Unknown', inline: false },
        { name: 'Message Content', value: content.substring(0, 500) || 'No content', inline: false }
      );

    await warningChannel.send({ embeds: [embed] });
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
 * Times out a user for a specified duration.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user
 * @param {number} durationSeconds
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
      logger.warn('Cannot timeout user, member not found in guild.', { userId: user.id });
      return;
    }

    const botMember = guild.members.me;
    if (!botMember.permissions.has('ModerateMembers')) {
      logger.warn('Cannot timeout user, bot lacks ModerateMembers permission.', { userId: user.id });
      return;
    }

    if (member.roles.highest.position >= botMember.roles.highest.position) {
      logger.warn("Cannot timeout user, user's role is higher than or equal to bot's role.", { userId: user.id });
      return;
    }

    const durationMs = Math.floor(Number(durationSeconds) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      logger.warn('Cannot timeout user: invalid durationSeconds', { userId: user.id, durationSeconds, durationMs });
      return;
    }

    const maxMs = 28 * 24 * 60 * 60 * 1000;
    const clampedMs = Math.min(durationMs, maxMs);

    if (!dayjs().add(clampedMs, 'millisecond').isValid()) {
      logger.warn('Cannot timeout user: invalid calculated end date', { userId: user.id, durationSeconds, clampedMs });
      return;
    }

    await member.timeout(clampedMs, 'Spam detected - automatic timeout');
    logger.info('Timed out user due to spam detection.', { userTag: user.tag, userId: user.id, durationSeconds });
  } catch (error) {
    logger.error('Error occurred while timing out user.', { err: error, userId: user.id, guildId: guild.id });
  }
}

module.exports = {
  trackNewUserMessage
};
