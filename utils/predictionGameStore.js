const path = require('path');
const config = require('../config');
const keyvModule = require('keyv');
const Keyv = keyvModule.default ?? keyvModule;
const { getSharedKeyvStore } = require('./sqliteStore');
const logger = require('../logger')(path.basename(__filename));

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

  const PENDING_PREDICTION_TTL_MS = config.predictionPendingTtlMs;

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
    const list = await getRegisteredUserIds();
    if (!list.includes(userId)) {
      list.push(userId);
      await keyv.set('registered', list);
    }
    await trackParticipant(userId);
  }

  async function getPrediction(userId, fixtureId) {
    return (await keyv.get(`prediction:${userId}:${fixtureId}`)) || null;
  }

  async function savePrediction(userId, fixtureId, prediction) {
    await keyv.set(`prediction:${userId}:${fixtureId}`, prediction);

    const indexKey = `predictions_by_fixture:${fixtureId}`;
    const userIds = (await keyv.get(indexKey)) || [];
    if (!userIds.includes(userId)) {
      userIds.push(userId);
      await keyv.set(indexKey, userIds);
    }

    const userIndexKey = `user_predictions:${userId}`;
    const fixtureIds = (await keyv.get(userIndexKey)) || [];
    if (!fixtureIds.includes(fixtureId)) {
      fixtureIds.push(fixtureId);
      await keyv.set(userIndexKey, fixtureIds);
    }

    await trackParticipant(userId);
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
    const list = await getPromptedFixtures();
    if (!list.includes(fixtureId)) {
      list.push(fixtureId);
      await keyv.set('prompted_fixtures', list);
    }
  }

  async function getScoredFixtures() {
    return (await keyv.get('scored_fixtures')) || [];
  }

  async function markFixtureScored(fixtureId) {
    const list = await getScoredFixtures();
    if (!list.includes(fixtureId)) {
      list.push(fixtureId);
      await keyv.set('scored_fixtures', list);
    }
  }

  async function getPredictorIdsForFixture(fixtureId) {
    return (await keyv.get(`predictions_by_fixture:${fixtureId}`)) || [];
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
    getPredictorIdsForFixture,
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
  isPendingPredictionComplete
};
