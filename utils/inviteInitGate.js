/** @type {Promise<void>} Resolves once invite usage baseline is stored on startup. */
let initPromise = Promise.resolve();

/** @type {(() => void) | null} */
let resolveInit = null;

/**
 * Called from ready.js before processing guildMemberAdd invite checks.
 * @returns {Promise<void>}
 */
function waitForInviteInit() {
  return initPromise;
}

/**
 * Marks invite initialization complete so join handlers can attribute invites.
 * @returns {void}
 */
function markInviteInitComplete() {
  if (resolveInit) {
    resolveInit();
    resolveInit = null;
  }
}

/**
 * Resets the gate for a new startup cycle (used when invite init begins).
 * Resolves any waiters on the previous promise so they are not orphaned.
 * @returns {void}
 */
function resetInviteInitGate() {
  if (resolveInit) {
    resolveInit();
    resolveInit = null;
  }
  initPromise = new Promise((resolve) => {
    resolveInit = resolve;
  });
}

resetInviteInitGate();

module.exports = {
  waitForInviteInit,
  markInviteInitComplete,
  resetInviteInitGate
};
