/** @type {Set<string>} User IDs kicked for account age before guildMemberRemove runs. */
const pendingAgeKicks = new Set();

/**
 * Marks a member as pending age-kick so guildMemberRemove skips former-member tracking.
 * @param {string} userId
 * @returns {void}
 */
function markPendingAgeKick(userId) {
  pendingAgeKicks.add(userId);
}

/**
 * Clears a pending age-kick marker (e.g. when kick fails).
 * @param {string} userId
 * @returns {void}
 */
function clearPendingAgeKick(userId) {
  pendingAgeKicks.delete(userId);
}

/**
 * Returns true if this leave was from an age kick and clears the marker.
 * @param {string} userId
 * @returns {boolean}
 */
function consumePendingAgeKick(userId) {
  if (!pendingAgeKicks.has(userId)) {
    return false;
  }
  pendingAgeKicks.delete(userId);
  return true;
}

/**
 * Clears pending markers (for unit tests only).
 * @returns {void}
 */
function resetPendingAgeKicksForTests() {
  pendingAgeKicks.clear();
}

module.exports = {
  markPendingAgeKick,
  clearPendingAgeKick,
  consumePendingAgeKick,
  resetPendingAgeKicksForTests
};
