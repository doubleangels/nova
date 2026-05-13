/**
 * Background job for pruning inactive users from the guild.
 * Used by the dashboard inactivity prune API.
 */

const logger = require('../logger')('utils:inactivityPruneTask');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

const INACTIVITY_KICK_REASON =
  'Inactivity - We kick members who are inactive; we want an active community more than a large one! Feel free to rejoin if you wish!';

/**
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {number} params.days
 * @param {string} params.excludedRole
 * @param {import('discord.js').GuildMember} params.botMember
 * @param {Record<string, number>} params.activityMap
 * @param {import('discord.js').Collection<string, import('discord.js').GuildMember>} params.members
 * @param {AbortSignal | null} [params.signal]
 * @param {(evt: object) => void | Promise<void>} [params.onProgress]
 */
async function runInactivityPrune({
  guild,
  days,
  excludedRole,
  botMember,
  activityMap,
  members,
  signal = null,
  onProgress = async () => {}
}) {
  const emit = onProgress;
  const now = Date.now();
  const inactivityThresholdMs = days * 24 * 60 * 60 * 1000;
  const botRolePos = botMember.roles.highest.position;

  const inactivityTargets = [];
  members.forEach((m) => {
    if (m.user.bot) return;
    if (excludedRole && m.roles.cache.has(excludedRole)) return;
    if (m.id === guild.ownerId) return;
    if (m.roles.highest.position >= botRolePos) return;

    const lastActivity = activityMap[m.id];
    if (lastActivity) {
      if (now - lastActivity > inactivityThresholdMs) inactivityTargets.push(m);
    } else {
      const joinTs = m.joinedTimestamp || 0;
      if (now - joinTs > inactivityThresholdMs) inactivityTargets.push(m);
    }
  });

  const total = inactivityTargets.length;
  await emit({
    type: 'start',
    total,
    percent: 0
  });

  if (total === 0) {
    await emit({
      type: 'done',
      kicked: 0,
      failed: 0,
      percent: 100
    });
    return { kicked: 0, failed: 0 };
  }

  let kicked = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw abortError();
    
    const m = inactivityTargets[i];
    try {
      await m.kick(INACTIVITY_KICK_REASON);
      kicked++;
    } catch (err) {
      failed++;
      logger.error('Failed to kick member during prune.', { 
        userId: m.id, 
        tag: m.user.tag, 
        err: err.message 
      });
    }

    const percent = Math.min(99, Math.round(((i + 1) / total) * 100));
    await emit({
      type: 'progress',
      kicked,
      failed,
      current: i + 1,
      total,
      percent,
      lastKickedTag: m.user.tag
    });

    // 250ms sleep to avoid Discord API 429
    await sleep(250);
  }

  await emit({
    type: 'done',
    kicked,
    failed,
    percent: 100
  });

  return { kicked, failed };
}

module.exports = {
  runInactivityPrune,
  INACTIVITY_KICK_REASON
};
