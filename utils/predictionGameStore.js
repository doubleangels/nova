const path = require('path');
const config = require('../config');
const keyvModule = require('keyv');
const Keyv = keyvModule.default ?? keyvModule;
const { getSharedKeyvStore, getWritableDb } = require('./sqliteStore');
const logger = require('../logger')(path.basename(__filename));

/** Max fixture IDs kept in prompted/scored tracking lists before oldest entries are pruned. */
const MAX_TRACKED_FIXTURES = 512;

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
    logger.error(`${logLabel} Keyv connection error.`, { err })
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

  function appendTrackedIdInTx(db, listKey, fixtureId) {
    let list = getInTx(db, listKey) || [];
    if (!list.includes(fixtureId)) {
      list.push(fixtureId);
      if (list.length > MAX_TRACKED_FIXTURES) {
        list = list.slice(-MAX_TRACKED_FIXTURES);
      }
      setInTx(db, listKey, list);
    }
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
    return (await keyv.get('prompted_fixtures')) || [];
  }

  async function markFixturePrompted(fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    if (normalizedId == null) return;

    const list = runStoreTransaction((db) => {
      let prompted = getInTx(db, 'prompted_fixtures') || [];
      if (listIncludesFixtureId(prompted, normalizedId)) {
        return prompted;
      }
      prompted.push(normalizedId);
      if (prompted.length > MAX_TRACKED_FIXTURES) {
        prompted = prompted.slice(-MAX_TRACKED_FIXTURES);
      }
      setInTx(db, 'prompted_fixtures', prompted);
      return prompted;
    });
    await keyv.set('prompted_fixtures', list);
  }

  /**
   * Atomically reserves a fixture for prompting. Returns false if already prompted.
   * @param {unknown} fixtureId
   * @returns {Promise<boolean>}
   */
  async function tryClaimFixtureForPrompt(fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    if (normalizedId == null) return false;

    const list = runStoreTransaction((db) => {
      let prompted = getInTx(db, 'prompted_fixtures') || [];
      if (listIncludesFixtureId(prompted, normalizedId)) {
        return null;
      }
      prompted.push(normalizedId);
      if (prompted.length > MAX_TRACKED_FIXTURES) {
        prompted = prompted.slice(-MAX_TRACKED_FIXTURES);
      }
      setInTx(db, 'prompted_fixtures', prompted);
      return prompted;
    });

    if (!list) return false;
    await keyv.set('prompted_fixtures', list);
    return true;
  }

  /**
   * Rolls back a prompt claim when the channel post fails.
   * @param {unknown} fixtureId
   * @returns {Promise<void>}
   */
  async function releaseFixturePromptClaim(fixtureId) {
    const normalizedId = normalizeFixtureId(fixtureId);
    if (normalizedId == null) return;

    const list = runStoreTransaction((db) => {
      const prompted = getInTx(db, 'prompted_fixtures') || [];
      const next = prompted.filter(id => normalizeFixtureId(id) !== normalizedId);
      if (next.length === prompted.length) return null;
      setInTx(db, 'prompted_fixtures', next);
      return next;
    });

    if (list) {
      await keyv.set('prompted_fixtures', list);
    }
  }

  async function getScoredFixtures() {
    return (await keyv.get('scored_fixtures')) || [];
  }

  async function markFixtureScored(fixtureId) {
    runStoreTransaction((db) => {
      appendTrackedIdInTx(db, 'scored_fixtures', fixtureId);
    });
  }

  /**
   * @param {number} fixtureId
   * @returns {Promise<boolean>}
   */
  async function tryAcquireScoringLock(fixtureId) {
    return runStoreTransaction((db) => {
      const row = db.prepare('SELECT value FROM keyv WHERE key = ?').get(fullKey(`scoring_lock:${fixtureId}`));
      if (row) return false;
      db.prepare('INSERT INTO keyv (key, value) VALUES (?, ?)').run(
        fullKey(`scoring_lock:${fixtureId}`),
        wrapKeyvValue(1)
      );
      return true;
    });
  }

  /**
   * @param {number} fixtureId
   * @returns {Promise<void>}
   */
  async function releaseScoringLock(fixtureId) {
    await keyv.delete(`scoring_lock:${fixtureId}`);
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
    return runStoreTransaction((db) => {
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
        setInTx(
          db,
          'registered',
          registered.filter(id => id !== userId)
        );
        summary.wasRegistered = true;
        summary.hadData = true;
      }

      const participantsRaw = getInTx(db, 'all_participants');
      const participants = Array.isArray(participantsRaw) ? participantsRaw : [];
      if (participants.includes(userId)) {
        setInTx(
          db,
          'all_participants',
          participants.filter(id => id !== userId)
        );
        summary.hadData = true;
      }

      const pointsRow = db
        .prepare('SELECT value FROM keyv WHERE key = ?')
        .get(fullKey(`points:${userId}`));
      if (pointsRow) {
        const points = getInTx(db, `points:${userId}`) || 0;
        summary.points = points;
        db.prepare('DELETE FROM keyv WHERE key = ?').run(fullKey(`points:${userId}`));
        summary.hadData = true;
      }

      const fixtureIds = getInTx(db, `user_predictions:${userId}`) || [];
      for (const fixtureId of fixtureIds) {
        db.prepare('DELETE FROM keyv WHERE key = ?').run(
          fullKey(`prediction:${userId}:${fixtureId}`)
        );

        const indexKey = `predictions_by_fixture:${fixtureId}`;
        const predictorIdsRaw = getInTx(db, indexKey);
        const predictorIds = Array.isArray(predictorIdsRaw) ? predictorIdsRaw : [];
        const nextPredictorIds = predictorIds.filter(id => id !== userId);
        if (nextPredictorIds.length === 0) {
          db.prepare('DELETE FROM keyv WHERE key = ?').run(fullKey(indexKey));
        } else {
          setInTx(db, indexKey, nextPredictorIds);
        }
        summary.predictionCount += 1;
        summary.hadData = true;
      }

      if (fixtureIds.length > 0) {
        db.prepare('DELETE FROM keyv WHERE key = ?').run(
          fullKey(`user_predictions:${userId}`)
        );
      }

      const pendingPattern = `${fullKey(`pending_prediction:${userId}:`)}%`;
      const pendingRows = db
        .prepare('SELECT key FROM keyv WHERE key LIKE ?')
        .all(pendingPattern);
      for (const row of pendingRows) {
        db.prepare('DELETE FROM keyv WHERE key = ?').run(row.key);
        summary.pendingCount += 1;
        summary.hadData = true;
      }

      return summary;
    });
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
    await keyv.set(
      'prompted_fixtures',
      prompted.filter(id => !mockIds.includes(id))
    );

    const scored = await getScoredFixtures();
    await keyv.set(
      'scored_fixtures',
      scored.filter(id => !mockIds.includes(id))
    );

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

  return {
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
}

module.exports = {
  createPredictionStore,
  isPendingPredictionComplete,
  MAX_TRACKED_FIXTURES
};
