/** @type {Map<string, { usage: Record<string, number>, updatedAt: number }>} */
const inviteSnapshots = new Map();

function setInviteSnapshot(guildId, usage) {
  inviteSnapshots.set(guildId, { usage: { ...usage }, updatedAt: Date.now() });
}

function getInviteSnapshot(guildId) {
  return inviteSnapshots.get(guildId)?.usage ?? null;
}

function updateInviteSnapshotFromCollection(guildId, invitesCollection) {
  const usage = {};
  invitesCollection.each((invite) => {
    usage[invite.code] = invite.uses || 0;
  });
  setInviteSnapshot(guildId, usage);
  return usage;
}

function patchInviteUsage(guildId, code, uses) {
  const entry = inviteSnapshots.get(guildId);
  const usage = entry ? { ...entry.usage } : {};
  usage[code] = uses;
  setInviteSnapshot(guildId, usage);
}

function removeInviteFromSnapshot(guildId, code) {
  const entry = inviteSnapshots.get(guildId);
  if (!entry) return;
  const usage = { ...entry.usage };
  const normalized = code.toLowerCase();
  const key = Object.keys(usage).find((k) => k.toLowerCase() === normalized);
  if (key) delete usage[key];
  setInviteSnapshot(guildId, usage);
}

module.exports = {
  setInviteSnapshot,
  getInviteSnapshot,
  updateInviteSnapshotFromCollection,
  patchInviteUsage,
  removeInviteFromSnapshot
};
