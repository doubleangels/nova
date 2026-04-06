const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');
const dayjs = require('dayjs');
const { getValue, getSpamModeJoinTime, removeSpamModeJoinTime } = require('./database');

// ── In-memory tracking stores ─────────────────────────────────────────────────

/** @type {Map<string, Map<string, Array>>} userId -> normalizedContent -> message occurrences */
const userMessageTracker = new Map();

// ── Detection constants ───────────────────────────────────────────────────────

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
 * Short preview of message text for mod summaries (stored per tracked occurrence).
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string}
 */
function truncateContentPreview(text, maxLen = 120) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '(empty or attachments only)';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/**
 * Human-readable breakdown of duplicate messages by channel (before deletion).
 * @param {Array<{ channelId: string, channelName: string, timestamp: number, messageId: string, contentPreview?: string }>} occurrences
 * @returns {string}
 */
function formatDeletedMessagesSummary(occurrences) {
  if (!occurrences?.length) return '_No details_';

  const sorted = [...occurrences].sort((a, b) => a.timestamp - b.timestamp);
  const channelOrder = [];
  const seen = new Set();
  for (const occ of sorted) {
    if (!seen.has(occ.channelId)) {
      seen.add(occ.channelId);
      channelOrder.push(occ.channelId);
    }
  }

  const lines = [];
  const maxTotal = 1000;

  for (const chId of channelOrder) {
    const inChannel = sorted.filter(o => o.channelId === chId);
    const name = inChannel[0].channelName || 'unknown';
    lines.push(`**#${name}** · ${inChannel.length} message${inChannel.length === 1 ? '' : 's'}`);
    for (const occ of inChannel) {
      const preview =
        occ.contentPreview != null && String(occ.contentPreview).trim() !== ''
          ? occ.contentPreview
          : '(preview unavailable)';
      lines.push(`• ${preview}`);
    }
  }

  let out = lines.join('\n');
  if (out.length > maxTotal) {
    out = `${out.slice(0, maxTotal - 24)}\n_(summary truncated)_`;
  }
  return out || '_No details_';
}

/** Prefix for spam-alert moderation buttons (handled in interactionCreate). */
const SPAM_WARN_BUTTON_PREFIX = 'spamWarn';

/**
 * @param {string} customId
 * @returns {{ action: string, targetUserId?: string }|null}
 */
function parseSpamWarnButtonId(customId) {
  const parts = customId.split(':');
  if (parts[0] !== SPAM_WARN_BUTTON_PREFIX || parts.length < 2) return null;
  if (parts[1] === 'dismiss') return { action: 'dismiss' };
  if (parts.length !== 3) return null;
  const action = parts[1];
  const targetUserId = parts[2];
  if (!/^\d{17,20}$/.test(targetUserId)) return null;
  return { action, targetUserId };
}

function buildSpamWarningButtons(targetUserId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SPAM_WARN_BUTTON_PREFIX}:timeout1h:${targetUserId}`)
      .setLabel('Timeout 1h')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${SPAM_WARN_BUTTON_PREFIX}:kick:${targetUserId}`)
      .setLabel('Kick')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${SPAM_WARN_BUTTON_PREFIX}:ban:${targetUserId}`)
      .setLabel('Ban')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${SPAM_WARN_BUTTON_PREFIX}:dismiss`)
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Builds the spam alert embed and button row.
 * @param {import('discord.js').User} user
 * @param {Array<{ channelId: string, channelName: string, timestamp: number, messageId: string, contentPreview?: string }>} occurrences
 * @param {boolean} dmSent
 */
function buildSpamWarningPayload(user, occurrences, dmSent) {
  const dmStatusValue = dmSent ? '✅ Sent' : '❌ Failed';
  const summary = formatDeletedMessagesSummary(occurrences);

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('🔤 Spam Detected — Duplicate Content')
    .setDescription(
      '_A 10-minute timeout was applied automatically. Use the buttons below for further action._'
    )
    .addFields(
      { name: 'User', value: `${user} (${user.tag})`, inline: true },
      { name: 'User ID', value: user.id, inline: true },
      { name: 'DM notification', value: dmStatusValue, inline: true },
      { name: 'Occurrences', value: `${occurrences.length}`, inline: true },
      {
        name: 'Messages removed (by channel)',
        value: summary,
        inline: false
      }
    );

  return {
    embeds: [embed],
    components: [buildSpamWarningButtons(user.id)]
  };
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
      return;
    }

    // Skip slash commands
    if (message.content?.trim().startsWith('/')) {
      logger.debug('Spam mode: Message is a slash command, skipping tracking.');
      return;
    }

    const messageTimestamp = message.createdTimestamp || dayjs().valueOf();

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
      messageId: message.id,
      contentPreview: truncateContentPreview(contentWithoutEmotes)
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
        await postSpamWarning(message.guild, message.author, existingOccurrences, dmSent);
        await timeoutUser(message.guild, message.author, 600, 'Spam detected: duplicate or similar messages');

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
 * Posts a mod-channel warning embed when duplicate spam is detected.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user
 * @param {Array<{ channelId: string, channelName: string, timestamp: number, messageId: string, contentPreview?: string }>} occurrences
 * @param {boolean} dmSent - Whether a DM notification was successfully sent to the user.
 * @returns {Promise<void>}
 */
async function postSpamWarning(guild, user, occurrences, dmSent = false) {
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

    const payload = buildSpamWarningPayload(user, occurrences, dmSent);
    await warningChannel.send(payload);
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
 * Handles moderation buttons on spam alert messages.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} True if this interaction was handled (caller should return)
 */
async function handleSpamWarningButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(`${SPAM_WARN_BUTTON_PREFIX}:`)) {
    return false;
  }

  const parsed = parseSpamWarnButtonId(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      content: 'Invalid spam alert control.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  try {
    const spamChannelId = await getValue('spam_mode_channel_id');
    if (!spamChannelId || interaction.channelId !== spamChannelId) {
      await interaction.reply({
        content: 'These controls only work on spam alerts in the configured spam channel.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: 'This can only be used in a server.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const moderator = interaction.member;
    if (!moderator || typeof moderator.permissions?.has !== 'function') {
      await interaction.reply({ content: 'Could not verify your permissions.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (parsed.action === 'dismiss') {
      if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        await interaction.reply({
          content: 'You need **Moderate Members** to dismiss.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      await interaction.deferUpdate();
      await interaction.message.edit({ components: [] }).catch(err => {
        logger.warn('Could not remove spam alert buttons.', { err });
      });
      return true;
    }

    const targetUserId = parsed.targetUserId;

    const botMember = guild.members.me;
    if (!botMember) {
      await interaction.reply({ content: 'Bot member not available.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
    const reasonBase = 'Spam alert — duplicate content (moderator action)';

    if (parsed.action === 'timeout1h') {
      if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        await interaction.reply({
          content: 'You need **Moderate Members** to use this.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (!targetMember) {
        await interaction.reply({
          content: 'Member not found — they may have left.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        await interaction.reply({
          content: 'The bot lacks **Moderate Members**.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
        await interaction.reply({
          content: 'Cannot moderate this member (role hierarchy).',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (moderator.id !== guild.ownerId && targetMember.roles.highest.position >= moderator.roles.highest.position) {
        await interaction.reply({
          content: 'You cannot timeout this member (role hierarchy).',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const durationMs = 60 * 60 * 1000;
      try {
        await targetMember.timeout(durationMs, `${reasonBase} (${interaction.user.tag})`);
        await interaction.reply({
          content: `Timed out ${targetMember} for **1 hour**.`,
          flags: MessageFlags.Ephemeral
        });
      } catch (err) {
        logger.error('Spam alert timeout failed.', { err, targetUserId });
        await interaction.reply({
          content: `Failed to timeout: ${err.message || 'unknown error'}`,
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
      return true;
    }

    if (parsed.action === 'kick') {
      if (!moderator.permissions.has(PermissionFlagsBits.KickMembers)) {
        await interaction.reply({
          content: 'You need **Kick Members** to use this.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (!targetMember) {
        await interaction.reply({
          content: 'Member not found — they may have left.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
        await interaction.reply({
          content: 'The bot lacks **Kick Members**.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
        await interaction.reply({
          content: 'Cannot kick this member (role hierarchy).',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (moderator.id !== guild.ownerId && targetMember.roles.highest.position >= moderator.roles.highest.position) {
        await interaction.reply({
          content: 'You cannot kick this member (role hierarchy).',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      await interaction.deferUpdate();
      try {
        await targetMember.kick(`${reasonBase} (${interaction.user.tag})`);
        await interaction.message.edit({ components: [] }).catch(() => {});
        await interaction.followUp({
          content: `Kicked **${targetMember.user.tag}**.`,
          flags: MessageFlags.Ephemeral
        });
      } catch (err) {
        logger.error('Spam alert kick failed.', { err, targetUserId });
        await interaction.followUp({
          content: `Failed to kick: ${err.message || 'unknown error'}`,
          flags: MessageFlags.Ephemeral
        });
      }
      return true;
    }

    if (parsed.action === 'ban') {
      if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) {
        await interaction.reply({
          content: 'You need **Ban Members** to use this.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
        await interaction.reply({
          content: 'The bot lacks **Ban Members**.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (targetMember) {
        if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
          await interaction.reply({
            content: 'Cannot ban this member (role hierarchy).',
            flags: MessageFlags.Ephemeral
          });
          return true;
        }
        if (moderator.id !== guild.ownerId && targetMember.roles.highest.position >= moderator.roles.highest.position) {
          await interaction.reply({
            content: 'You cannot ban this member (role hierarchy).',
            flags: MessageFlags.Ephemeral
          });
          return true;
        }
      }

      await interaction.deferUpdate();
      try {
        await guild.members.ban(targetUserId, {
          reason: `${reasonBase} (${interaction.user.tag})`,
          deleteMessageSeconds: 0
        });
        await interaction.message.edit({ components: [] }).catch(() => {});
        await interaction.followUp({
          content: `Banned user \`${targetUserId}\`.`,
          flags: MessageFlags.Ephemeral
        });
      } catch (err) {
        logger.error('Spam alert ban failed.', { err, targetUserId });
        await interaction.followUp({
          content: `Failed to ban: ${err.message || 'unknown error'}`,
          flags: MessageFlags.Ephemeral
        });
      }
      return true;
    }

    await interaction.reply({ content: 'Unknown action.', flags: MessageFlags.Ephemeral });
    return true;
  } catch (error) {
    logger.error('Error handling spam warning button.', { err: error });
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
      }
    } catch (_) { /* ignore */ }
    return true;
  }
}

/**
 * Times out a user for a specified duration.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user
 * @param {number} durationSeconds
 * @param {string} [reason] - Shown in the moderation audit log
 * @returns {Promise<void>}
 */
async function timeoutUser(guild, user, durationSeconds, reason = 'Spam detected — automatic timeout') {
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

    await member.timeout(clampedMs, reason);
    logger.info('Timed out user due to spam detection.', { userTag: user.tag, userId: user.id, durationSeconds });
  } catch (error) {
    logger.error('Error occurred while timing out user.', { err: error, userId: user.id, guildId: guild.id });
  }
}

module.exports = {
  trackNewUserMessage,
  handleSpamWarningButton
};
