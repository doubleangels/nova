/**
 * Backfill `last_message:<userId>` in the main Keyv namespace from guild channel history.
 * Used by the dashboard maintenance API (`/api/maintenance/seed-last-messages`).
 */

const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { Routes } = require('discord-api-types/v10');
const Database = require('better-sqlite3');

const DEFAULT_MAX_PER_CHANNEL = 10000;
const DEFAULT_DELAY_MS = 300;

/** @typedef {'channel_scan' | 'member_search'} SeedLastMessagesStrategy */

/** Default channel history scan (existing behavior). */
const SEED_STRATEGY_CHANNEL_SCAN = 'channel_scan';
/** Uses `GET /guilds/:id/messages/search` per member (MESSAGE_CONTENT + search index). */
const SEED_STRATEGY_MEMBER_SEARCH = 'member_search';

const DISCORD_EPOCH_MS = 1420070400000;

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
 * @param {number} membersTotal
 * @param {number} memberIndex 0-based index of member being processed
 * @returns {number} approximate 0–85
 */
function memberSearchProgressPercent(membersTotal, memberIndex) {
  if (membersTotal <= 0) return 0;
  const w = 85 / membersTotal;
  return Math.min(85, Math.round((memberIndex + 1) * w));
}

/**
 * Flatten nested `messages` arrays from Search Guild Messages responses.
 * @param {any} data
 * @returns {any[]}
 */
function flattenGuildSearchMessages(data) {
  if (!data || !Array.isArray(data.messages)) return [];
  const out = [];
  for (const group of data.messages) {
    if (Array.isArray(group)) {
      for (const m of group) {
        if (m) out.push(m);
      }
    }
  }
  return out;
}

/**
 * @param {any} msg
 * @returns {number}
 */
function apiMessageCreatedMs(msg) {
  if (!msg) return 0;
  if (msg.timestamp) {
    const t = Date.parse(msg.timestamp);
    if (!Number.isNaN(t)) return t;
  }
  if (msg.id) {
    try {
      return Number((BigInt(msg.id) >> 22n) + BigInt(DISCORD_EPOCH_MS));
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * @param {any[]} flat
 * @param {string} authorId
 * @returns {any | null}
 */
function newestMessageForAuthor(flat, authorId) {
  let best = null;
  let bestTs = 0;
  for (const m of flat) {
    if (!m || m.author?.id !== authorId) continue;
    const t = apiMessageCreatedMs(m);
    if (t >= bestTs) {
      bestTs = t;
      best = m;
    }
  }
  return best;
}

/**
 * @param {URLSearchParams} params
 */
function appendSnowflakeArray(params, key, ids) {
  if (!ids?.length) return;
  for (const id of ids) {
    params.append(key, String(id));
  }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {object} query
 * @param {{ signal?: AbortSignal, maxAttempts?: number }} [opts]
 * @returns {Promise<any>}
 */
async function fetchGuildMessagesSearchRaw(guild, query, opts = {}) {
  const { signal, maxAttempts = 12 } = opts;
  const params = new URLSearchParams();
  appendSnowflakeArray(params, 'author_id', query.author_id);
  appendSnowflakeArray(params, 'author_type', query.author_type);
  appendSnowflakeArray(params, 'channel_id', query.channel_id);
  if (query.sort_by) params.set('sort_by', String(query.sort_by));
  if (query.sort_order) params.set('sort_order', String(query.sort_order));
  params.set('limit', String(Math.min(25, Math.max(1, query.limit ?? 25))));
  params.set('include_nsfw', 'true');
  if (query.content) params.set('content', String(query.content));

  let attempt = 0;
  while (attempt < maxAttempts) {
    if (signal?.aborted) throw abortError();
    /** @type {any} */
    const data = await guild.client.rest.get(Routes.guildMessagesSearch(guild.id), {
      query: params
    });
    if (data && data.code === 110000) {
      const waitSec = typeof data.retry_after === 'number' ? data.retry_after : 2;
      await sleep(Math.max(400, Math.ceil(waitSec * 1000)));
      attempt++;
      continue;
    }
    return data;
  }
  throw new Error('Guild message search: index not ready after retries (code 110000).');
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {{ signal?: AbortSignal }} [opts]
 */
async function fetchLatestUserMessageFromGuildSearch(guild, userId, opts = {}) {
  const data = await fetchGuildMessagesSearchRaw(
    guild,
    {
      author_id: [userId],
      author_type: ['user'],
      sort_by: 'timestamp',
      sort_order: 'desc',
      limit: 25
    },
    { signal: opts.signal }
  );
  const flat = flattenGuildSearchMessages(data);
  return newestMessageForAuthor(flat, userId);
}

/**
 * @param {ReturnType<createTempUserTimestampStore>} tempStore
 * @param {import('keyv').default} keyv
 * @param {boolean} onlyMissing
 * @param {boolean} dryRun
 * @param {AbortSignal | null} signal
 * @param {Map<string, string> | null} channelByUser — optional `last_message_channel` writes
 * @param {(evt: object) => void | Promise<void>} onProgress
 * @param {number} messagesScanned — for write_start event
 */
async function mergeTempStoreToKeyv(
  tempStore,
  keyv,
  onlyMissing,
  dryRun,
  signal,
  channelByUser,
  onProgress,
  messagesScanned
) {
  const emit = onProgress;
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
        const chId = channelByUser?.get(userId);
        if (chId) {
          await keyv.set(`last_message_channel:${userId}`, chId);
        }
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

  return { usersUpdated, usersSkipped };
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
 * @param {import('keyv').default} params.keyv
 * @param {number} [params.delayMs]
 * @param {boolean} [params.onlyMissing]
 * @param {boolean} [params.dryRun]
 * @param {AbortSignal | null} [params.signal]
 * @param {(evt: object) => void | Promise<void>} [params.onProgress]
 * @param {number} [params.maxMembers]
 */
async function runSeedLastMessagesMemberSearch({
  guild,
  keyv,
  delayMs = DEFAULT_DELAY_MS,
  onlyMissing = false,
  dryRun = false,
  signal = null,
  onProgress = async () => {},
  maxMembers = 50000
}) {
  const emit = onProgress;
  await guild.members.fetch().catch(() => {});

  const humans = guild.members.cache.filter((m) => m.user && !m.user.bot);
  let list = Array.from(humans.values());
  const cap = Math.min(50000, Math.max(1, maxMembers));
  if (list.length > cap) list = list.slice(0, cap);

  const tempStore = createTempUserTimestampStore();
  /** @type {Map<string, string>} */
  const channelByUser = new Map();
  /** @type {{ userId: string, username?: string, message: string }[]} */
  const searchErrors = [];

  try {
    await emit({
      type: 'start',
      strategy: SEED_STRATEGY_MEMBER_SEARCH,
      guildId: guild.id,
      guildName: guild.name,
      channelsTotal: 0,
      membersTotal: list.length,
      maxPerChannel: null,
      dryRun,
      onlyMissing,
      percent: 0
    });

    let messagesScanned = 0;

    for (let i = 0; i < list.length; i++) {
      if (signal?.aborted) throw abortError();
      const m = list[i];
      const uid = m.id;

      if (onlyMissing) {
        let existing = null;
        try {
          existing = await keyv.get(`last_message:${uid}`);
        } catch {
          existing = null;
        }
        const existingNum = typeof existing === 'number' ? existing : Number(existing);
        if (existing != null && !Number.isNaN(existingNum)) {
          await emit({
            type: 'member_batch',
            memberIndex: i,
            membersTotal: list.length,
            userId: uid,
            skippedExisting: true,
            messagesScanned,
            usersTracked: tempStore.countUsers(),
            percent: memberSearchProgressPercent(list.length, i)
          });
          if (delayMs > 0) await sleep(delayMs);
          continue;
        }
      }

      await emit({
        type: 'member_start',
        memberIndex: i,
        membersTotal: list.length,
        userId: uid,
        memberTag: m.user?.tag || uid,
        messagesScanned,
        usersTracked: tempStore.countUsers(),
        percent: memberSearchProgressPercent(list.length, i)
      });

      try {
        const msg = await fetchLatestUserMessageFromGuildSearch(guild, uid, { signal });
        messagesScanned += 1;
        if (msg) {
          const ts = apiMessageCreatedMs(msg);
          if (ts > 0) {
            tempStore.upsertMax(uid, ts);
            if (msg.channel_id) channelByUser.set(uid, String(msg.channel_id));
          }
        }
      } catch (err) {
        searchErrors.push({
          userId: uid,
          username: m.user?.username,
          message: err && err.message ? String(err.message) : String(err)
        });
      }

      if (delayMs > 0) await sleep(delayMs);

      await emit({
        type: 'member_batch',
        memberIndex: i,
        membersTotal: list.length,
        userId: uid,
        messagesScanned,
        usersTracked: tempStore.countUsers(),
        percent: memberSearchProgressPercent(list.length, i)
      });
    }

    const merge = await mergeTempStoreToKeyv(
      tempStore,
      keyv,
      onlyMissing,
      dryRun,
      signal,
      channelByUser,
      onProgress,
      messagesScanned
    );

    const result = {
      guildId: guild.id,
      guildName: guild.name,
      strategy: SEED_STRATEGY_MEMBER_SEARCH,
      messagesScanned,
      usersTracked: tempStore.countUsers(),
      usersUpdated: merge.usersUpdated,
      usersSkipped: merge.usersSkipped,
      channelsScanned: 0,
      channelErrors: [],
      searchErrors,
      dryRun,
      onlyMissing
    };

    await emit({ type: 'done', percent: 100, result });
    return result;
  } finally {
    tempStore.closeAndDelete();
  }
}

/**
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('keyv').default} params.keyv — main namespace Keyv (`get` / `set`)
 * @param {number} [params.maxPerChannel]
 * @param {number} [params.delayMs]
 * @param {string[] | null} [params.channelIds]
 * @param {boolean} [params.onlyMissing=false] - When true, skip users that already have stored timestamps.
 * @param {boolean} [params.dryRun]
 * @param {AbortSignal | null} [params.signal]
 * @param {(evt: object) => void | Promise<void>} [params.onProgress]
 * @param {SeedLastMessagesStrategy} [params.strategy='channel_scan'] — `member_search` uses Discord Search Guild Messages per member (requires MESSAGE_CONTENT; may return 202 while indexing). Search always includes age-restricted channels (`include_nsfw`).
 * @param {number} [params.maxMembers=50000] — member_search only: cap humans processed.
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
  onProgress = async () => {},
  strategy = SEED_STRATEGY_CHANNEL_SCAN,
  maxMembers = 50000
}) {
  const strat =
    strategy === SEED_STRATEGY_MEMBER_SEARCH ? SEED_STRATEGY_MEMBER_SEARCH : SEED_STRATEGY_CHANNEL_SCAN;
  if (strat === SEED_STRATEGY_MEMBER_SEARCH) {
    return runSeedLastMessagesMemberSearch({
      guild,
      keyv,
      delayMs,
      onlyMissing,
      dryRun,
      signal,
      onProgress,
      maxMembers
    });
  }

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
    strategy: SEED_STRATEGY_CHANNEL_SCAN,
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
  const merge = await mergeTempStoreToKeyv(
    tempStore,
    keyv,
    onlyMissing,
    dryRun,
    signal,
    null,
    onProgress,
    messagesScanned
  );

  const result = {
    guildId: guild.id,
    guildName: guild.name,
    strategy: SEED_STRATEGY_CHANNEL_SCAN,
    messagesScanned,
    usersTracked,
    usersUpdated: merge.usersUpdated,
    usersSkipped: merge.usersSkipped,
    channelsScanned: channels.length,
    channelErrors,
    searchErrors: [],
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
  SEED_STRATEGY_CHANNEL_SCAN,
  SEED_STRATEGY_MEMBER_SEARCH,
  isScannableGuildChannel,
  canReadHistory,
  resolveScannableChannels,
  scanChannelMessages,
  runSeedLastMessages
};
