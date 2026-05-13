/**
 * Background job for removing duplicate Discord invites.
 * Redundant invites are defined as those pointing to the same channel with identical settings.
 */

const logger = require('../logger')('utils:inviteCleanupTask');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {AbortSignal | null} [params.signal]
 * @param {(evt: object) => void | Promise<void>} [params.onProgress]
 */
async function runDuplicateInviteCleanup({
  guild,
  signal = null,
  onProgress = async () => {}
}) {
  const emit = onProgress;
  
  await emit({ type: 'status', message: 'Fetching invites from Discord...', percent: 5 });
  const invites = await guild.invites.fetch();
  
  if (signal?.aborted) throw abortError();

  // Group invites by channel and settings
  // Key: channelId:maxAge:maxUses:temporary
  const groups = new Map();

  invites.forEach((inv) => {
    const key = `${inv.channelId}:${inv.maxAge}:${inv.maxUses}:${inv.temporary}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(inv);
  });

  const toDelete = [];
  groups.forEach((list) => {
    if (list.length <= 1) return;

    // Sort by uses (desc), then by createdTimestamp (desc)
    // We want to KEEP the first one in the sorted list
    list.sort((a, b) => {
      if (b.uses !== a.uses) return b.uses - a.uses;
      return (b.createdTimestamp || 0) - (a.createdTimestamp || 0);
    });

    // Everything except the first one goes to the delete bucket
    for (let i = 1; i < list.length; i++) {
      toDelete.push(list[i]);
    }
  });

  const total = toDelete.length;
  await emit({
    type: 'start',
    total,
    percent: 10
  });

  if (total === 0) {
    await emit({
      type: 'done',
      deleted: 0,
      failed: 0,
      percent: 100
    });
    return { deleted: 0, failed: 0 };
  }

  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw abortError();

    const inv = toDelete[i];
    try {
      await inv.delete('Duplicate invite cleanup via Maintenance');
      deleted++;
    } catch (err) {
      failed++;
      logger.error('Failed to delete duplicate invite.', { 
        code: inv.code, 
        err: err.message 
      });
    }

    const percent = Math.min(99, 10 + Math.round(((i + 1) / total) * 90));
    await emit({
      type: 'progress',
      deleted,
      failed,
      current: i + 1,
      total,
      percent,
      lastDeletedCode: inv.code
    });

    // Small delay to be safe with rate limits
    await sleep(200);
  }

  await emit({
    type: 'done',
    deleted,
    failed,
    percent: 100
  });

  return { deleted, failed };
}

module.exports = {
  runDuplicateInviteCleanup
};
