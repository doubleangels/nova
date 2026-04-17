/**
 * Backfill `last_message:<userId>` in the main Keyv namespace from guild channel history.
 * Used by the dashboard maintenance API (`/api/maintenance/seed-last-messages`).
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const DEFAULT_MAX_PER_CHANNEL = 10000;
const DEFAULT_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

function isScannableGuildChannel(channel) {
  if (!channel || channel.isDMBased?.()) return false;
  const t = channel.type;
  return (
    t === ChannelType.GuildText ||
    t === ChannelType.GuildAnnouncement ||
    t === ChannelType.PublicThread ||
    t === ChannelType.PrivateThread
  );
}

/**
 * @param {import('discord.js').GuildChannel} channel
 * @param {import('discord.js').GuildMember | null} me
 */
function canReadHistory(channel, me) {
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.ReadMessageHistory);
}

/**
 * @param {number} channelsTotal
 * @param {number} channelIndex 0-based index of channel currently being scanned
 * @param {number} fetchedInChannel messages fetched so far in this channel
 * @param {number} maxPerChannel
 * @returns {number} approximate 0–85
 */
function scanProgressPercent(channelsTotal, channelIndex, fetchedInChannel, maxPerChannel) {
  if (channelsTotal <= 0) return 0;
  const channelWeight = 85 / channelsTotal;
  const prev = channelIndex * channelWeight;
  const cur = Math.min(1, fetchedInChannel / Math.max(1, maxPerChannel)) * channelWeight;
  return Math.min(85, Math.round(prev + cur));
}

/**
 * @param {import('discord.js').TextChannel | import('discord.js').ThreadChannel | import('discord.js').NewsChannel} channel
 * @param {number} maxPerChannel
 * @param {number} delayMs
 * @param {Map<string, number>} maxTsByUser
 * @param {{ signal?: AbortSignal, onBatch?: (info: { fetched: number, batchSize: number, usersTracked: number }) => void }} [opts]
 */
async function scanChannelMessages(channel, maxPerChannel, delayMs, maxTsByUser, opts = {}) {
  const { signal, onBatch } = opts;
  let fetched = 0;
  /** @type {string|undefined} */
  let before;

  while (fetched < maxPerChannel) {
    if (signal?.aborted) throw abortError();
    const limit = Math.min(100, maxPerChannel - fetched);
    const batch = await channel.messages.fetch({ limit, before });
    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      if (msg.author?.bot) continue;
      if (msg.webhookId) continue;
      const id = msg.author?.id;
      if (!id) continue;
      const ts = msg.createdTimestamp;
      const prev = maxTsByUser.get(id);
      if (prev == null || ts > prev) maxTsByUser.set(id, ts);
    }

    fetched += batch.size;
    const oldest = batch.last();
    before = oldest ? oldest.id : undefined;
    if (typeof onBatch === 'function') {
      onBatch({ fetched, batchSize: batch.size, usersTracked: maxTsByUser.size });
    }
    if (batch.size < limit) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  return fetched;
}

/**
 * Resolve ordered list of channels the bot can scan.
 * @param {import('discord.js').Guild} guild
 * @param {{ channelIds?: string[] | null }} [opts]
 */
function resolveScannableChannels(guild, opts = {}) {
  const channelIds = opts.channelIds || null;
  const me = guild.members.me;

  return guild.channels.cache
    .filter((ch) => isScannableGuildChannel(ch))
    .filter((ch) => (channelIds ? channelIds.includes(ch.id) : true))
    .filter((ch) => canReadHistory(ch, me))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((ch) => ch);
}

/**
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('keyv').default} params.keyv — main namespace Keyv (`get` / `set`)
 * @param {number} [params.maxPerChannel]
 * @param {number} [params.delayMs]
 * @param {string[] | null} [params.channelIds]
 * @param {boolean} [params.onlyMissing]
 * @param {boolean} [params.dryRun]
 * @param {AbortSignal | null} [params.signal]
 * @param {(evt: object) => void | Promise<void>} [params.onProgress]
 */
async function runSeedLastMessages({
  guild,
  keyv,
  maxPerChannel = DEFAULT_MAX_PER_CHANNEL,
  delayMs = DEFAULT_DELAY_MS,
  channelIds = null,
  onlyMissing = false,
  dryRun = false,
  signal = null,
  onProgress = async () => {}
}) {
  await guild.channels.fetch().catch(() => {});

  const channels = resolveScannableChannels(guild, { channelIds });
  if (channels.length === 0) {
    throw new Error('No channels to scan (check bot permissions and filters).');
  }

  const emit = async (evt) => {
    await onProgress(evt);
  };

  await emit({
    type: 'start',
    guildId: guild.id,
    guildName: guild.name,
    channelsTotal: channels.length,
    maxPerChannel,
    dryRun,
    onlyMissing,
    percent: 0
  });

  const maxTsByUser = new Map();
  let messagesScanned = 0;
  /** @type {{ channelId: string, channelName: string, message: string }[]} */
  const channelErrors = [];

  let channelIndex = 0;
  for (const ch of channels) {
    if (signal?.aborted) throw abortError();

    await emit({
      type: 'channel_start',
      channelIndex,
      channelsTotal: channels.length,
      channelId: ch.id,
      channelName: ch.name,
      messagesScanned,
      usersTracked: maxTsByUser.size,
      percent: scanProgressPercent(channels.length, channelIndex, 0, maxPerChannel)
    });

    if (!('messages' in ch) || typeof ch.messages?.fetch !== 'function') {
      channelErrors.push({
        channelId: ch.id,
        channelName: ch.name || 'unknown',
        message: 'Channel is not message-fetchable'
      });
      channelIndex++;
      continue;
    }

    try {
      const n = await scanChannelMessages(
        /** @type {import('discord.js').TextChannel} */ (ch),
        maxPerChannel,
        delayMs,
        maxTsByUser,
        {
          signal,
          onBatch: ({ fetched }) => {
            void emit({
              type: 'channel_batch',
              channelIndex,
              channelsTotal: channels.length,
              channelId: ch.id,
              channelName: ch.name,
              fetchedInChannel: fetched,
              messagesScanned: messagesScanned + fetched,
              usersTracked: maxTsByUser.size,
              percent: scanProgressPercent(channels.length, channelIndex, fetched, maxPerChannel)
            });
          }
        }
      );
      messagesScanned += n;
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      channelErrors.push({
        channelId: ch.id,
        channelName: ch.name || 'unknown',
        message: err && err.message ? String(err.message) : String(err)
      });
    }

    await emit({
      type: 'channel_done',
      channelIndex,
      channelsTotal: channels.length,
      channelId: ch.id,
      channelName: ch.name,
      messagesScanned,
      usersTracked: maxTsByUser.size,
      percent: scanProgressPercent(channels.length, channelIndex + 1, 0, maxPerChannel)
    });

    channelIndex++;
  }

  const entries = [...maxTsByUser.entries()];
  let usersUpdated = 0;
  let usersSkipped = 0;

  await emit({
    type: 'write_start',
    usersToWrite: entries.length,
    messagesScanned,
    usersTracked: maxTsByUser.size,
    percent: 85
  });

  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) throw abortError();
    const [userId, scannedTs] = entries[i];
    const key = `last_message:${userId}`;
    let existing = null;
    try {
      existing = await keyv.get(key);
    } catch (_) {
      existing = null;
    }
    const existingNum = typeof existing === 'number' ? existing : Number(existing);
    const hasExisting = existing != null && !Number.isNaN(existingNum);

    if (onlyMissing && hasExisting) {
      usersSkipped++;
    } else {
      const merged = hasExisting ? Math.max(existingNum, scannedTs) : scannedTs;
      const wouldWrite = !(hasExisting && merged === existingNum);

      if (dryRun) {
        if (wouldWrite) usersUpdated++;
        else usersSkipped++;
      } else if (!wouldWrite) {
        usersSkipped++;
      } else {
        await keyv.set(key, merged);
        usersUpdated++;
      }
    }

    if (i % 20 === 0 || i === entries.length - 1) {
      await emit({
        type: 'write_progress',
        usersUpdated,
        usersSkipped,
        writeIndex: i + 1,
        writesTotal: entries.length,
        percent: 85 + Math.round(((i + 1) / Math.max(1, entries.length)) * 14)
      });
    }
  }

  const result = {
    guildId: guild.id,
    guildName: guild.name,
    messagesScanned,
    usersTracked: maxTsByUser.size,
    usersUpdated,
    usersSkipped,
    channelsScanned: channels.length,
    channelErrors,
    dryRun,
    onlyMissing
  };

  await emit({ type: 'done', percent: 100, result });
  return result;
}

module.exports = {
  DEFAULT_MAX_PER_CHANNEL,
  DEFAULT_DELAY_MS,
  isScannableGuildChannel,
  canReadHistory,
  resolveScannableChannels,
  scanChannelMessages,
  runSeedLastMessages
};
