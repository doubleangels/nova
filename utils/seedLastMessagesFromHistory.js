/**
 * Backfill `last_message:<userId>` in the main Keyv namespace from guild channel history.
 * Used by the dashboard maintenance API (`/api/maintenance/seed-last-messages`).
 */

const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const Database = require('better-sqlite3');

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
 * @param {(userId: string, ts: number) => void} onUserMessage
 * @param {{ signal?: AbortSignal, onBatch?: (info: { fetched: number, batchSize: number, usersTracked: number }) => void, getUsersTracked?: () => number }} [opts]
 */
async function scanChannelMessages(channel, maxPerChannel, delayMs, onUserMessage, opts = {}) {
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
      onUserMessage(id, ts);
    }

    fetched += batch.size;
    const oldest = batch.last();
    before = oldest ? oldest.id : undefined;
    if (typeof onBatch === 'function') {
      onBatch({
        fetched,
        batchSize: batch.size,
        usersTracked: typeof opts.getUsersTracked === 'function' ? opts.getUsersTracked() : 0
      });
    }
    if (batch.size < limit) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  return fetched;
}

/**
 * Disk-backed temp store for max timestamp by user (memory efficient).
 * @returns {{
 *   upsertMax: (userId: string, ts: number) => void,
 *   countUsers: () => number,
 *   iterateRows: () => IterableIterator<{ userId: string, ts: number }>,
 *   closeAndDelete: () => void
 * }}
 */
function createTempUserTimestampStore() {
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const tempPath = path.join(
    dataDir,
    `.seed-last-messages-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );
  const db = new Database(tempPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_last_ts (
      user_id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
  `);
  const upsert = db.prepare(`
    INSERT INTO user_last_ts (user_id, ts)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      ts = CASE WHEN excluded.ts > user_last_ts.ts THEN excluded.ts ELSE user_last_ts.ts END;
  `);
  const countStmt = db.prepare('SELECT COUNT(*) AS c FROM user_last_ts');
  const iterateStmt = db.prepare('SELECT user_id AS userId, ts FROM user_last_ts');

  return {
    upsertMax(userId, ts) {
      upsert.run(userId, ts);
    },
    countUsers() {
      return Number(countStmt.get().c || 0);
    },
    iterateRows() {
      return iterateStmt.iterate();
    },
    closeAndDelete() {
      try { db.close(); } catch {}
      try { fs.unlinkSync(tempPath); } catch {}
    }
  };
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
 * @param {boolean} [params.onlyMissing=true] - Keep true to avoid overwriting existing data.
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
  onlyMissing = true,
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

  let messagesScanned = 0;
  /** @type {{ channelId: string, channelName: string, message: string }[]} */
  const channelErrors = [];

  const tempStore = createTempUserTimestampStore();
  let trackedUsersApprox = 0;

  let channelIndex = 0;
  try {
    for (const ch of channels) {
    if (signal?.aborted) throw abortError();

    await emit({
      type: 'channel_start',
      channelIndex,
      channelsTotal: channels.length,
      channelId: ch.id,
      channelName: ch.name,
      messagesScanned,
      usersTracked: trackedUsersApprox,
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
        (userId, ts) => {
          tempStore.upsertMax(userId, ts);
        },
        {
          signal,
          getUsersTracked: () => trackedUsersApprox,
          onBatch: ({ fetched }) => {
            if (fetched % 500 === 0 || fetched <= 100) {
              trackedUsersApprox = tempStore.countUsers();
            }
            void emit({
              type: 'channel_batch',
              channelIndex,
              channelsTotal: channels.length,
              channelId: ch.id,
              channelName: ch.name,
              fetchedInChannel: fetched,
              messagesScanned: messagesScanned + fetched,
              usersTracked: trackedUsersApprox,
              percent: scanProgressPercent(channels.length, channelIndex, fetched, maxPerChannel)
            });
          }
        }
      );
      messagesScanned += n;
      trackedUsersApprox = tempStore.countUsers();
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
      usersTracked: trackedUsersApprox,
      percent: scanProgressPercent(channels.length, channelIndex + 1, 0, maxPerChannel)
    });

    channelIndex++;
  }

  const usersTracked = tempStore.countUsers();
  let usersUpdated = 0;
  let usersSkipped = 0;

  await emit({
    type: 'write_start',
    usersToWrite: usersTracked,
    messagesScanned,
    usersTracked,
    percent: 85
  });

  let i = 0;
  for (const row of tempStore.iterateRows()) {
    if (signal?.aborted) throw abortError();
    const userId = row.userId;
    const scannedTs = row.ts;
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

    i++;
    if (i % 20 === 0 || i === usersTracked) {
      await emit({
        type: 'write_progress',
        usersUpdated,
        usersSkipped,
        writeIndex: i,
        writesTotal: usersTracked,
        percent: 85 + Math.round((i / Math.max(1, usersTracked)) * 14)
      });
    }
  }

  const result = {
    guildId: guild.id,
    guildName: guild.name,
    messagesScanned,
    usersTracked,
    usersUpdated,
    usersSkipped,
    channelsScanned: channels.length,
    channelErrors,
    dryRun,
    onlyMissing
  };

  await emit({ type: 'done', percent: 100, result });
  return result;
  } finally {
    tempStore.closeAndDelete();
  }
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
