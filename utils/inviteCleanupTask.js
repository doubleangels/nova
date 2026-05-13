/**
 * Background job for removing duplicate entries from the Recent Joins history.
 * Retroactively applies deduplication logic to the invite join history array.
 */

const logger = require('../logger')('utils:inviteCleanupTask');

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/** 
 * Matches isNearDuplicateInviteJoinRow in database.js 
 * 15 second window for near-identical join events.
 */
const DEDUP_MS = 15_000;

function normalizeInviteCode(code) {
  if (code == null) return null;
  const s = String(code).trim();
  return s ? s.toLowerCase() : null;
}

function isDuplicate(a, b) {
  if (String(a.userId || '') !== String(b.userId || '')) return false;
  
  const t0 = new Date(a.at || 0).getTime();
  const t1 = new Date(b.at || 0).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
  
  if (Math.abs(t0 - t1) > DEDUP_MS) return false;
  
  const c0 = normalizeInviteCode(a.inviteCode);
  const c1 = normalizeInviteCode(b.inviteCode);
  if (c0 && c1 && c0 !== c1) return false;
  
  return true;
}

/**
 * @param {object} params
 * @param {string} params.guildId
 * @param {import('keyv')} params.inviteKeyv
 * @param {AbortSignal | null} [params.signal]
 * @param {(evt: object) => void | Promise<void>} [params.onProgress]
 */
async function runInviteHistoryCleanup({
  guildId,
  inviteKeyv,
  signal = null,
  onProgress = async () => {}
}) {
  const emit = onProgress;
  
  await emit({ type: 'status', message: 'Fetching join history from database...', percent: 10 });
  const key = `join_history:${guildId}`;
  const raw = await inviteKeyv.get(key);
  
  if (signal?.aborted) throw abortError();

  const history = Array.isArray(raw) ? raw : [];
  if (history.length === 0) {
    await emit({ type: 'done', deleted: 0, failed: 0, percent: 100 });
    return { deleted: 0, failed: 0 };
  }

  await emit({ type: 'status', message: `Analyzing ${history.length} records...`, percent: 30 });
  
  const cleaned = [];
  let duplicatesFound = 0;

  for (let i = 0; i < history.length; i++) {
    if (signal?.aborted) throw abortError();
    
    const current = history[i];
    // Check if 'current' is a duplicate of anything we've already kept
    // Since history is newest first, we keep the FIRST one we encounter (the newest one)
    const isDup = cleaned.some(kept => isDuplicate(kept, current));
    
    if (isDup) {
      duplicatesFound++;
    } else {
      cleaned.push(current);
    }

    if (i % 50 === 0 || i === history.length - 1) {
      const pct = 30 + Math.round((i / history.length) * 40);
      await emit({ 
        type: 'progress', 
        deleted: duplicatesFound, 
        failed: 0, 
        current: i + 1, 
        total: history.length,
        percent: pct 
      });
    }
  }

  if (duplicatesFound > 0) {
    await emit({ type: 'status', message: `Saving ${cleaned.length} cleaned records...`, percent: 80 });
    await inviteKeyv.set(key, cleaned);
  }

  await emit({
    type: 'done',
    deleted: duplicatesFound,
    failed: 0,
    percent: 100
  });

  logger.info('Invite history cleanup completed.', { 
    guildId, 
    originalCount: history.length, 
    removedCount: duplicatesFound 
  });

  return { deleted: duplicatesFound, failed: 0 };
}

module.exports = {
  runDuplicateInviteCleanup: runInviteHistoryCleanup
};
