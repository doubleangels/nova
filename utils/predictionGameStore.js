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
    runStoreTransaction((db) => {
      appendTrackedIdInTx(db, 'prompted_fixtures', fixtureId);
    });
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
    getUserPoints,
    addUserPoints,
    subtractUserPoints,
    getPromptedFixtures,
    markFixturePrompted,
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
