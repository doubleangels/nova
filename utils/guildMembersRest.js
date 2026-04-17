/**
 * Paginated REST listing for guild members (GET /guilds/:id/members).
 * Avoids gateway opcode 8 (Request Guild Members) used by GuildMemberManager#fetch().
 */

const { Collection } = require('@discordjs/collection');

const PAGE_SIZE = 1000;
const DEFAULT_PAGE_DELAY_MS = 300;
const DEFAULT_MAX_PAGE_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('@discordjs/collection').Collection<string, import('discord.js').GuildMember>} batch
 * @returns {string|undefined}
 */
function maxMemberId(batch) {
  if (!batch || batch.size === 0) return undefined;
  let max = null;
  for (const id of batch.keys()) {
    if (!max || BigInt(id) > BigInt(max)) max = id;
  }
  return max;
}

/**
 * @param {unknown} err
 * @returns {number | null} ms to wait, or null if not a retryable REST 429
 */
function getRestRateLimitWaitMs(err) {
  const st =
    err && typeof err === 'object'
      ? /** @type {{ status?: number; statusCode?: number }} */ (err).status ??
        /** @type {{ status?: number; statusCode?: number }} */ (err).statusCode
      : undefined;
  if (st !== 429) return null;
  const data = /** @type {{ data?: { retry_after?: number }, rawError?: { retry_after?: number } }} */ (err);
  const sec = data?.data?.retry_after ?? data?.rawError?.retry_after;
  if (typeof sec === 'number' && Number.isFinite(sec)) {
    return Math.min(120_000, Math.ceil(sec * 1000) + Math.floor(Math.random() * 250));
  }
  return 1500;
}

/**
 * Fetch all guild members via REST pagination (no gateway member request).
 *
 * @param {import('discord.js').Guild} guild
 * @param {{ pageDelayMs?: number, maxPageAttempts?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<import('@discordjs/collection').Collection<string, import('discord.js').GuildMember>>}
 */
async function fetchAllGuildMembersViaRest(guild, opts = {}) {
  const pageDelayMs =
    typeof opts.pageDelayMs === 'number' && opts.pageDelayMs >= 0
      ? opts.pageDelayMs
      : DEFAULT_PAGE_DELAY_MS;
  const maxPageAttempts =
    typeof opts.maxPageAttempts === 'number' && opts.maxPageAttempts >= 1
      ? opts.maxPageAttempts
      : DEFAULT_MAX_PAGE_ATTEMPTS;
  const { signal } = opts;

  const merged = new Collection();
  /** @type {string | undefined} */
  let after;

  for (;;) {
    if (signal?.aborted) {
      const e = new Error('Aborted');
      e.name = 'AbortError';
      throw e;
    }

    /** @type {import('@discordjs/collection').Collection<string, import('discord.js').GuildMember> | null} */
    let batch = null;
    let pageAttempt = 0;
    while (pageAttempt < maxPageAttempts) {
      try {
        batch = await guild.members.list({ limit: PAGE_SIZE, after, cache: true });
        break;
      } catch (err) {
        pageAttempt += 1;
        const waitMs = getRestRateLimitWaitMs(err);
        if (waitMs != null && pageAttempt < maxPageAttempts) {
          await sleep(waitMs);
          continue;
        }
        throw err;
      }
    }

    if (!batch || batch.size === 0) break;

    batch.forEach((m, id) => merged.set(id, m));

    if (batch.size < PAGE_SIZE) break;

    const nextAfter = maxMemberId(batch);
    if (!nextAfter || nextAfter === after) break;
    after = nextAfter;

    if (pageDelayMs > 0) await sleep(pageDelayMs);
  }

  return merged;
}

module.exports = {
  fetchAllGuildMembersViaRest,
  PAGE_SIZE,
  DEFAULT_PAGE_DELAY_MS
};
