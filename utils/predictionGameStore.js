const path = require('path');
const config = require('../config');
const { serializeError } = require('./logSanitize');
const keyvModule = require('keyv');
const Keyv = keyvModule.default ?? keyvModule;
const { getSharedKeyvStore, getWritableDb } = require('./sqliteStore');
const logger = require('../logger')(path.basename(__filename));

/** @deprecated Legacy list cap; per-fixture flags are authoritative. Kept for export/tests. */
const MAX_TRACKED_FIXTURES = 512;

/** Stale scoring locks older than this are cleared on startup or replaced on acquire. */
const SCORING_LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * @typedef {Object} GamePrediction
 * @property {number} homeScore
 * @property {number} awayScore
 * @property {'home'|'draw'|'away'} resultPick
 * @property {string} submittedAt
 * @property {boolean} [scored]
 * @property {number} [scorePoints]
 * @property {number} [resultPoints]
 * @property {number} [pointsAwarded]
 */

/**
 * @typedef {Object} PendingPrediction
 * @property {number} [homeScore]
 * @property {number} [awayScore]
 * @property {'home'|'draw'|'away'} [resultPick]
 * @property {string} updatedAt
 */

/**
 * @param {PendingPrediction|null|undefined} pending
 * @returns {boolean}
 */
function isPendingPredictionComplete(pending) {
  if (!pending) return false;
  const home = pending.homeScore;
  const away = pending.awayScore;
  return (
    Number.isInteger(home) &&
    home >= 0 &&
    home <= 15 &&
    Number.isInteger(away) &&
    away >= 0 &&
    away <= 15 &&
    ['home', 'draw', 'away'].includes(pending.resultPick)
  );
}

/**
 * @param {string} namespace
 * @param {string} logLabel
 * @returns {object}
 */
function createPredictionStore(namespace, logLabel) {
  const keyv = new Keyv({
    store: getSharedKeyvStore(),
    namespace
  });

  keyv.on('error', err =>
    logger.error(`${logLabel} Keyv connection error.`, serializeError(err, { includeStack: true }))
  );

  const keyPrefix = `${namespace}:`;

  function fullKey(key) {
    return `${keyPrefix}${key}`;
  }

  function parseKeyvValue(rawValue) {
    if (rawValue == null) return null;
    try {
      const parsed = JSON.parse(rawValue);
      return parsed?.value !== undefined ? parsed.value : parsed;
    } catch {
      return null;
    }
  }

  function wrapKeyvValue(value) {
    return JSON.stringify({ value, expires: null });
  }

  function getInTx(db, key) {
    const row = db.prepare('SELECT value FROM keyv WHERE key = ?').get(fullKey(key));
    return parseKeyvValue(row?.value);
  }

  function setInTx(db, key, value) {
    db.prepare(`
      INSERT INTO keyv (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(fullKey(key), wrapKeyvValue(value));
  }

  /**
   * @param {unknown} fixtureId
   * @returns {number|null}
   */
  function normalizeFixtureId(fixtureId) {
    const id = Number(fixtureId);
    return Number.isFinite(id) ? id : null;
  }

  /**
   * @param {unknown[]} list
   * @param {unknown} fixtureId
   * @returns {boolean}
   */
  function listIncludesFixtureId(list, fixtureId) {
    const normalized = normalizeFixtureId(fixtureId);
    return list.some(id => normalizeFixtureId(id) === normalized);
  }

  function promptedFlagKey(fixtureId) {
    return `fixture_prompted:${normalizeFixtureId(fixtureId)}`;
  }

  function scoredFlagKey(fixtureId) {
    return `fixture_scored:${normalizeFixtureId(fixtureId)}`;
  }

  function isFixturePromptedInTx(db, fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    /* istanbul ignore next -- defensive guard for invalid fixture ids */
    if (normalizedId == null) return false;
    const legacy = getInTx(db, 'prompted_fixtures') || [];
    if (listIncludesFixtureId(legacy, normalizedId)) return true;
    const row = db.prepare('SELECT value FROM keyv WHERE key = ?').get(fullKey(promptedFlagKey(normalizedId)));
    return Boolean(parseKeyvValue(row?.value));
  }

  function setFixturePromptedInTx(db, fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    /* istanbul ignore next -- defensive guard for invalid fixture ids */
    if (normalizedId == null) return;
    setInTx(db, promptedFlagKey(normalizedId), true);
  }

  function clearFixturePromptedInTx(db, fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    /* istanbul ignore next -- defensive guard for invalid fixture ids */
    if (normalizedId == null) return;
    db.prepare('DELETE FROM keyv WHERE key = ?').run(fullKey(promptedFlagKey(normalizedId)));
    const legacy = getInTx(db, 'prompted_fixtures') || [];
    const next = legacy.filter(id => normalizeFixtureId(id) !== normalizedId);
    if (next.length !== legacy.length) {
      setInTx(db, 'prompted_fixtures', next);
    }
  }

  function isFixtureScoredInTx(db, fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    /* istanbul ignore next -- defensive guard for invalid fixture ids */
    if (normalizedId == null) return false;
    const legacy = getInTx(db, 'scored_fixtures') || [];
    if (listIncludesFixtureId(legacy, normalizedId)) return true;
    const row = db.prepare('SELECT value FROM keyv WHERE key = ?').get(fullKey(scoredFlagKey(normalizedId)));
    return Boolean(parseKeyvValue(row?.value));
  }

  function setFixtureScoredInTx(db, fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    /* istanbul ignore next -- defensive guard for invalid fixture ids */
    if (normalizedId == null) return;
    if (isFixtureScoredInTx(db, normalizedId)) return;
    setInTx(db, scoredFlagKey(normalizedId), true);
  }

  function clearFixtureScoredInTx(db, fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    /* istanbul ignore next -- defensive guard for invalid fixture ids */
    if (normalizedId == null) return;
    db.prepare('DELETE FROM keyv WHERE key = ?').run(fullKey(scoredFlagKey(normalizedId)));
    const legacy = getInTx(db, 'scored_fixtures') || [];
    const next = legacy.filter(id => normalizeFixtureId(id) !== normalizedId);
    if (next.length !== legacy.length) {
      setInTx(db, 'scored_fixtures', next);
    }
  }

  function collectFixtureIdsFromFlagPrefix(db, flagPrefix) {
    const ids = new Set();
    const keyPrefix = fullKey(flagPrefix);
    const rows = db.prepare('SELECT key FROM keyv WHERE key LIKE ?').all(`${keyPrefix}%`);
    for (const row of rows) {
      const idPart = row.key.slice(keyPrefix.length);
      const normalized = normalizeFixtureId(idPart);
      if (normalized != null) ids.add(normalized);
    }
    return ids;
  }

  function parseScoringLockPayload(rawValue) {
    const parsed = parseKeyvValue(rawValue);
    if (parsed && typeof parsed === 'object' && parsed.acquiredAt) {
      return parsed;
    }
    if (parsed === 1 || parsed === true) {
      return { acquiredAt: null };
    }
    return null;
  }

  function isScoringLockStale(payload, nowMs = Date.now()) {
    if (!payload) return true;
    if (!payload.acquiredAt) return true;
    const acquiredMs = Date.parse(payload.acquiredAt);
    if (!Number.isFinite(acquiredMs)) return true;
    return nowMs - acquiredMs >= SCORING_LOCK_TTL_MS;
  }

  function appendTrackedIdInTx(db, listKey, fixtureId) {
    setFixtureScoredInTx(db, fixtureId);
  }

  const PENDING_PREDICTION_TTL_MS = config.predictionPendingTtlMs;

  let keyvTableReady = false;

  function ensureKeyvTable(db) {
    if (keyvTableReady) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS keyv (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    keyvTableReady = true;
  }

  function runStoreTransaction(fn) {
    const db = getWritableDb();
    ensureKeyvTable(db);
    return db.transaction(() => fn(db))();
  }

  /**
   * @param {string} userId
   */
  async function trackParticipant(userId) {
    const list = (await keyv.get('all_participants')) || [];
    if (!list.includes(userId)) {
      list.push(userId);
      await keyv.set('all_participants', list);
    }
  }

  async function getRegisteredUserIds() {
    return (await keyv.get('registered')) || [];
  }

  async function isUserRegistered(userId) {
    const list = await getRegisteredUserIds();
    return list.includes(userId);
  }

  async function addRegisteredUser(userId) {
    runStoreTransaction((db) => {
      const list = getInTx(db, 'registered') || [];
      if (!list.includes(userId)) {
        list.push(userId);
        setInTx(db, 'registered', list);
      }
      const participants = getInTx(db, 'all_participants') || [];
      if (!participants.includes(userId)) {
        participants.push(userId);
        setInTx(db, 'all_participants', participants);
      }
    });
  }

  async function getPrediction(userId, fixtureId) {
    return (await keyv.get(`prediction:${userId}:${fixtureId}`)) || null;
  }

  async function savePrediction(userId, fixtureId, prediction) {
    runStoreTransaction((db) => {
      setInTx(db, `prediction:${userId}:${fixtureId}`, prediction);

      const indexKey = `predictions_by_fixture:${fixtureId}`;
      const userIds = getInTx(db, indexKey) || [];
      if (!userIds.includes(userId)) {
        userIds.push(userId);
        setInTx(db, indexKey, userIds);
      }

      const userIndexKey = `user_predictions:${userId}`;
      const fixtureIds = getInTx(db, userIndexKey) || [];
      if (!fixtureIds.includes(fixtureId)) {
        fixtureIds.push(fixtureId);
        setInTx(db, userIndexKey, fixtureIds);
      }

      const participants = getInTx(db, 'all_participants') || [];
      if (!participants.includes(userId)) {
        participants.push(userId);
        setInTx(db, 'all_participants', participants);
      }
    });
  }

  async function getUserPredictionFixtureIds(userId) {
    return (await keyv.get(`user_predictions:${userId}`)) || [];
  }

  async function getAllPredictorUserIds() {
    const db = getWritableDb();
    const likePattern = `${fullKey('user_predictions:')}%`;
    const rows = db
      .prepare('SELECT key, value FROM keyv WHERE key LIKE ?')
      .all(likePattern);

    const userIds = [];
    for (const row of rows) {
      const fixtureIds = parseKeyvValue(row.value);
      if (!Array.isArray(fixtureIds) || fixtureIds.length === 0) continue;
      const userId = row.key.slice(fullKey('user_predictions:').length);
      if (userId) userIds.push(userId);
    }
    return userIds;
  }

  async function getUserPoints(userId) {
    return (await keyv.get(`points:${userId}`)) || 0;
  }

  async function addUserPoints(userId, delta) {
    const current = await getUserPoints(userId);
    const next = current + delta;
    await keyv.set(`points:${userId}`, next);
    if (next > 0) await trackParticipant(userId);
    return next;
  }

  async function subtractUserPoints(userId, delta) {
    const current = await getUserPoints(userId);
    const next = Math.max(0, current - delta);
    await keyv.set(`points:${userId}`, next);
    return next;
  }

  async function getPromptedFixtures() {
    return runStoreTransaction((db) => {
      const ids = collectFixtureIdsFromFlagPrefix(db, 'fixture_prompted:');
      for (const id of getInTx(db, 'prompted_fixtures') || []) {
        const normalized = normalizeFixtureId(id);
        if (normalized != null) ids.add(normalized);
      }
      return Array.from(ids).sort((a, b) => a - b);
    });
  }

  async function markFixturePrompted(fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    if (normalizedId == null) return;

    runStoreTransaction((db) => {
      if (!isFixturePromptedInTx(db, normalizedId)) {
        setFixturePromptedInTx(db, normalizedId);
      }
    });
  }

  /**
   * Atomically reserves a fixture for prompting. Returns false if already prompted.
   * @param {unknown} fixtureId
   * @returns {Promise<boolean>}
   */
  async function tryClaimFixtureForPrompt(fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    if (normalizedId == null) return false;

    const acquired = runStoreTransaction((db) => {
      if (isFixturePromptedInTx(db, normalizedId)) {
        return false;
      }
      setFixturePromptedInTx(db, normalizedId);
      return true;
    });

    return acquired;
  }

  /**
   * Rolls back a prompt claim when the channel post fails.
   * @param {unknown} fixtureId
   * @returns {Promise<void>}
   */
  async function releaseFixturePromptClaim(fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    if (normalizedId == null) return;

    runStoreTransaction((db) => {
      clearFixturePromptedInTx(db, normalizedId);
    });
  }

  async function getScoredFixtures() {
    return runStoreTransaction((db) => {
      const ids = collectFixtureIdsFromFlagPrefix(db, 'fixture_scored:');
      for (const id of getInTx(db, 'scored_fixtures') || []) {
        const normalized = normalizeFixtureId(id);
        if (normalized != null) ids.add(normalized);
      }
      return Array.from(ids).sort((a, b) => a - b);
    });
  }

  async function markFixtureScored(fixtureId) {
    runStoreTransaction((db) => {
      setFixtureScoredInTx(db, fixtureId);
    });
  }

  /**
   * @param {number} fixtureId
   * @returns {Promise<boolean>}
   */
  async function tryAcquireScoringLock(fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    if (normalizedId == null) return false;
    const now = Date.now();

    return runStoreTransaction((db) => {
      const key = fullKey(`scoring_lock:${normalizedId}`);
      const row = db.prepare('SELECT value FROM keyv WHERE key = ?').get(key);
      if (row) {
        const payload = parseScoringLockPayload(row.value);
        if (!isScoringLockStale(payload, now)) {
          return false;
        }
        db.prepare('DELETE FROM keyv WHERE key = ?').run(key);
      }
      db.prepare('INSERT INTO keyv (key, value) VALUES (?, ?)').run(
        key,
        wrapKeyvValue({ acquiredAt: new Date(now).toISOString() })
      );
      return true;
    });
  }

  /**
   * @param {number} fixtureId
   * @returns {Promise<void>}
   */
  async function releaseScoringLock(fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    if (normalizedId == null) return;
    await keyv.delete(`scoring_lock:${normalizedId}`);
  }

  /**
   * Removes scoring locks that expired or predate TTL metadata (e.g. after a crash).
   * @returns {number} Count of cleared locks
   */
  function clearStaleScoringLocks() {
    const now = Date.now();
    return runStoreTransaction((db) => {
      const prefix = fullKey('scoring_lock:');
      const rows = db.prepare('SELECT key, value FROM keyv WHERE key LIKE ?').all(`${prefix}%`);
      let cleared = 0;
      for (const row of rows) {
        const payload = parseScoringLockPayload(row.value);
        if (isScoringLockStale(payload, now)) {
          db.prepare('DELETE FROM keyv WHERE key = ?').run(row.key);
          cleared += 1;
        }
      }
      return cleared;
    });
  }

  /**
   * Persists scored predictions and points for a finished fixture in one transaction.
   * @param {number} fixtureId
   * @param {Array<{ userId: string, prediction: GamePrediction, pointsDelta: number }>} updates
   * @returns {Promise<void>}
   */
  async function applyFixtureScoringResults(fixtureId, updates) {
    runStoreTransaction((db) => {
      for (const { userId, prediction, pointsDelta } of updates) {
        setInTx(db, `prediction:${userId}:${fixtureId}`, prediction);
        if (pointsDelta > 0) {
          const current = getInTx(db, `points:${userId}`) || 0;
          const next = current + pointsDelta;
          setInTx(db, `points:${userId}`, next);
          if (next > 0) {
            const participants = getInTx(db, 'all_participants') || [];
            if (!participants.includes(userId)) {
              participants.push(userId);
              setInTx(db, 'all_participants', participants);
            }
          }
        }
      }
      appendTrackedIdInTx(db, 'scored_fixtures', fixtureId);
    });
  }

  async function getPredictorIdsForFixture(fixtureId) {
    return (await keyv.get(`predictions_by_fixture:${fixtureId}`)) || [];
  }

  /**
   * @param {number} fixtureId
   * @returns {Promise<Array<{ userId: string, prediction: GamePrediction|null }>>}
   */
  async function getPredictionsForFixture(fixtureId) {
    const userIds = await getPredictorIdsForFixture(fixtureId);
    return Promise.all(
      userIds.map(async (userId) => ({
        userId,
        prediction: await getPrediction(userId, fixtureId)
      }))
    );
  }

  /**
   * @param {string} userId
   * @param {number[]} fixtureIds
   * @returns {Promise<Array<{ fixtureId: number, prediction: GamePrediction|null }>>}
   */
  async function getPredictionsForUser(userId, fixtureIds) {
    return Promise.all(
      fixtureIds.map(async (fixtureId) => ({
        fixtureId,
        prediction: await getPrediction(userId, fixtureId)
      }))
    );
  }

  async function isPromptingPaused() {
    return Boolean(await keyv.get('prompting_paused'));
  }

  async function setPromptingPaused(paused) {
    if (paused) {
      await keyv.set('prompting_paused', true);
    } else {
      await keyv.delete('prompting_paused');
    }
  }

  /**
   * @param {string} userId
   * @param {number} fixtureId
   * @param {Partial<PendingPrediction>} partial
   */
  async function savePendingPrediction(userId, fixtureId, partial) {
    const existing = (await getPendingPrediction(userId, fixtureId)) || {};
    const next = {
      ...existing,
      ...partial,
      updatedAt: new Date().toISOString()
    };
    await keyv.set(
      `pending_prediction:${userId}:${fixtureId}`,
      next,
      PENDING_PREDICTION_TTL_MS
    );
    return next;
  }

  async function getPendingPrediction(userId, fixtureId) {
    return (await keyv.get(`pending_prediction:${userId}:${fixtureId}`)) || null;
  }

  async function clearPendingPrediction(userId, fixtureId) {
    await keyv.delete(`pending_prediction:${userId}:${fixtureId}`);
  }

  /**
   * @param {number} [limit]
   */
  async function getLeaderboard(limit = 10) {
    const registered = await getRegisteredUserIds();
    const participants = (await keyv.get('all_participants')) || [];
    const userIds = [...new Set([...registered, ...participants])];

    const entries = await Promise.all(
      userIds.map(async userId => ({
        userId,
        points: await getUserPoints(userId)
      }))
    );

    return entries
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
  }

  /**
   * @param {number[]} mockIds
   */
  async function areAllMockPlayableFixturesPredicted(mockIds) {
    if (!config.predictionMockApi) return false;
    for (const fixtureId of mockIds) {
      const predictorIds = await getPredictorIdsForFixture(fixtureId);
      if (predictorIds.length === 0) return false;
    }
    return true;
  }

  async function resetGame() {
    await keyv.clear();
  }

  /**
   * Removes all stored data for a user in this namespace.
   * @param {string} userId
   * @returns {Promise<{ hadData: boolean, wasRegistered: boolean, predictionCount: number, pendingCount: number, points: number }>}
   */
  async function removeUser(userId) {
    /** @type {Array<{ type: 'delete' | 'set', key: string, value?: unknown }>} */
    const cacheSyncOps = [];

    const summary = runStoreTransaction((db) => {
      const summary = {
        hadData: false,
        wasRegistered: false,
        predictionCount: 0,
        pendingCount: 0,
        points: 0
      };

      const registeredRaw = getInTx(db, 'registered');
      const registered = Array.isArray(registeredRaw) ? registeredRaw : [];
      if (registered.includes(userId)) {
        const nextRegistered = registered.filter(id => id !== userId);
        setInTx(db, 'registered', nextRegistered);
        cacheSyncOps.push({ type: 'set', key: 'registered', value: nextRegistered });
        summary.wasRegistered = true;
        summary.hadData = true;
      }

      const participantsRaw = getInTx(db, 'all_participants');
      const participants = Array.isArray(participantsRaw) ? participantsRaw : [];
      if (participants.includes(userId)) {
        const nextParticipants = participants.filter(id => id !== userId);
        setInTx(db, 'all_participants', nextParticipants);
        cacheSyncOps.push({ type: 'set', key: 'all_participants', value: nextParticipants });
        summary.hadData = true;
      }

      const pointsRow = db
        .prepare('SELECT value FROM keyv WHERE key = ?')
        .get(fullKey(`points:${userId}`));
      if (pointsRow) {
        const points = getInTx(db, `points:${userId}`) || 0;
        summary.points = points;
        db.prepare('DELETE FROM keyv WHERE key = ?').run(fullKey(`points:${userId}`));
        cacheSyncOps.push({ type: 'delete', key: `points:${userId}` });
        summary.hadData = true;
      }

      const fixtureIds = getInTx(db, `user_predictions:${userId}`) || [];
      for (const fixtureId of fixtureIds) {
        db.prepare('DELETE FROM keyv WHERE key = ?').run(
          fullKey(`prediction:${userId}:${fixtureId}`)
        );
        cacheSyncOps.push({ type: 'delete', key: `prediction:${userId}:${fixtureId}` });

        const indexKey = `predictions_by_fixture:${fixtureId}`;
        const predictorIdsRaw = getInTx(db, indexKey);
        const predictorIds = Array.isArray(predictorIdsRaw) ? predictorIdsRaw : [];
        const nextPredictorIds = predictorIds.filter(id => id !== userId);
        if (nextPredictorIds.length === 0) {
          db.prepare('DELETE FROM keyv WHERE key = ?').run(fullKey(indexKey));
          cacheSyncOps.push({ type: 'delete', key: indexKey });
        } else {
          setInTx(db, indexKey, nextPredictorIds);
          cacheSyncOps.push({ type: 'set', key: indexKey, value: nextPredictorIds });
        }
        summary.predictionCount += 1;
        summary.hadData = true;
      }

      if (fixtureIds.length > 0) {
        db.prepare('DELETE FROM keyv WHERE key = ?').run(
          fullKey(`user_predictions:${userId}`)
        );
        cacheSyncOps.push({ type: 'delete', key: `user_predictions:${userId}` });
      }

      const pendingPattern = `${fullKey(`pending_prediction:${userId}:`)}%`;
      const pendingRows = db
        .prepare('SELECT key FROM keyv WHERE key LIKE ?')
        .all(pendingPattern);
      for (const row of pendingRows) {
        db.prepare('DELETE FROM keyv WHERE key = ?').run(row.key);
        const logicalKey = row.key.slice(keyPrefix.length);
        cacheSyncOps.push({ type: 'delete', key: logicalKey });
        summary.pendingCount += 1;
        summary.hadData = true;
      }

      return summary;
    });

    for (const op of cacheSyncOps) {
      if (op.type === 'delete') {
        await keyv.delete(op.key);
      } else {
        await keyv.set(op.key, op.value);
      }
    }

    return summary;
  }

  /**
   * @param {number[]} mockIds
   * @param {'worldcup'|'club'} aiGameId
   */
  async function resetMockDemoState(mockIds, aiGameId) {
    if (!config.predictionMockApi) return;

    const { clearAiPredictionCache } = require('./matchPredictionAi');
    clearAiPredictionCache(mockIds, aiGameId);

    const prompted = await getPromptedFixtures();
    for (const fixtureId of mockIds) {
      if (prompted.includes(fixtureId)) {
        await releaseFixturePromptClaim(fixtureId);
      }
    }

    const scored = await getScoredFixtures();
    for (const fixtureId of mockIds) {
      if (scored.includes(fixtureId)) {
        runStoreTransaction((db) => {
          clearFixtureScoredInTx(db, fixtureId);
        });
      }
    }

    for (const fixtureId of mockIds) {
      const userIds = await getPredictorIdsForFixture(fixtureId);
      for (const userId of userIds) {
        const prediction = await getPrediction(userId, fixtureId);
        if (prediction?.scored && prediction.pointsAwarded) {
          await subtractUserPoints(userId, prediction.pointsAwarded);
        }
        await keyv.delete(`prediction:${userId}:${fixtureId}`);
        const userFixtureIds = await getUserPredictionFixtureIds(userId);
        await keyv.set(
          `user_predictions:${userId}`,
          userFixtureIds.filter(id => id !== fixtureId)
        );
      }
      await keyv.delete(`predictions_by_fixture:${fixtureId}`);
    }
  }

  const api = {
    keyv,
    getRegisteredUserIds,
    isUserRegistered,
    addRegisteredUser,
    getPrediction,
    savePrediction,
    getUserPredictionFixtureIds,
    getAllPredictorUserIds,
    getUserPoints,
    addUserPoints,
    subtractUserPoints,
    getPromptedFixtures,
    markFixturePrompted,
    tryClaimFixtureForPrompt,
    releaseFixturePromptClaim,
    getScoredFixtures,
    markFixtureScored,
    tryAcquireScoringLock,
    releaseScoringLock,
    clearStaleScoringLocks,
    applyFixtureScoringResults,
    getPredictorIdsForFixture,
    getPredictionsForFixture,
    getPredictionsForUser,
    savePendingPrediction,
    getPendingPrediction,
    clearPendingPrediction,
    getLeaderboard,
    resetGame,
    removeUser,
    resetMockDemoState,
    isPromptingPaused,
    setPromptingPaused,
    areAllMockPlayableFixturesPredicted,
    PENDING_PREDICTION_TTL_MS,
    isPendingPredictionComplete
  };

  if (process.env.NODE_ENV === 'test') {
    api.__test__ = { isScoringLockStale };
  }

  return api;
}

module.exports = {
  createPredictionStore,
  isPendingPredictionComplete,
  MAX_TRACKED_FIXTURES,
  SCORING_LOCK_TTL_MS
};
