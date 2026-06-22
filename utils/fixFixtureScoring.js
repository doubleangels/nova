const {
  calculateScorePoints,
  calculateResultPoints
} = require('./predictionGameScoring');

/**
 * @param {string} scoreText - e.g. "5-1"
 * @returns {{ home: number, away: number }}
 */
function parseScoreArg(scoreText) {
  const match = String(scoreText).trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    throw new Error(`Invalid score "${scoreText}". Expected format like 4-1.`);
  }
  return { home: Number(match[1]), away: Number(match[2]) };
}

/**
 * @param {import('./predictionGameStore').GamePrediction} prediction
 * @param {{ home: number, away: number }} actual
 * @returns {{ scorePoints: number, resultPoints: number, total: number }}
 */
function scorePrediction(prediction, actual) {
  const scorePoints = calculateScorePoints(
    prediction.homeScore,
    prediction.awayScore,
    actual.home,
    actual.away
  );
  const resultPoints = calculateResultPoints(
    prediction.resultPick,
    actual.home,
    actual.away
  );
  return { scorePoints, resultPoints, total: scorePoints + resultPoints };
}

/**
 * @param {import('./predictionGameStore').GamePrediction} prediction
 * @param {{ home: number, away: number }} wrongActual
 * @param {{ home: number, away: number }} correctActual
 * @returns {{
 *   oldTotal: number,
 *   newTotal: number,
 *   delta: number,
 *   oldScorePoints: number,
 *   newScorePoints: number,
 *   oldResultPoints: number,
 *   newResultPoints: number
 * }}
 */
function computeScoringCorrection(prediction, wrongActual, correctActual) {
  const oldScoring = scorePrediction(prediction, wrongActual);
  const newScoring = scorePrediction(prediction, correctActual);
  return {
    oldTotal: oldScoring.total,
    newTotal: newScoring.total,
    delta: newScoring.total - oldScoring.total,
    oldScorePoints: oldScoring.scorePoints,
    newScorePoints: newScoring.scorePoints,
    oldResultPoints: oldScoring.resultPoints,
    newResultPoints: newScoring.resultPoints
  };
}

/**
 * @param {unknown} rawValue
 * @returns {any}
 */
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

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} dbKey
 * @returns {any}
 */
function getDbValue(db, dbKey) {
  const row = db.prepare('SELECT value FROM keyv WHERE key = ?').get(dbKey);
  return parseKeyvValue(row?.value);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 * @param {number} fixtureId
 * @returns {Array<{ userId: string, prediction: import('./predictionGameStore').GamePrediction }>}
 */
function loadScoredPredictionsForFixture(db, namespace, fixtureId) {
  const indexKey = `${namespace}:predictions_by_fixture:${fixtureId}`;
  const userIds = getDbValue(db, indexKey);
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return [];
  }

  /** @type {Array<{ userId: string, prediction: import('./predictionGameStore').GamePrediction }>} */
  const entries = [];
  for (const userId of userIds) {
    const prediction = getDbValue(db, `${namespace}:prediction:${userId}:${fixtureId}`);
    if (!prediction?.scored) continue;
    entries.push({ userId, prediction });
  }
  return entries;
}

/**
 * @param {{
 *   namespace?: string,
 *   fixtureId: number,
 *   wrongActual: { home: number, away: number },
 *   correctActual: { home: number, away: number },
 *   loadPredictions?: (fixtureId: number) => Array<{ userId: string, prediction: import('./predictionGameStore').GamePrediction }>
 * }} params
 * @returns {Array<{
 *   userId: string,
 *   prediction: import('./predictionGameStore').GamePrediction,
 *   correction: ReturnType<typeof computeScoringCorrection>,
 *   currentPoints: number|null
 * }>}
 */
function planFixtureScoringCorrections(params) {
  const {
    namespace = 'football',
    fixtureId,
    wrongActual,
    correctActual,
    loadPredictions
  } = params;

  const entries = loadPredictions
    ? loadPredictions(fixtureId)
    : [];

  /** @type {ReturnType<typeof planFixtureScoringCorrections>} */
  const plan = [];

  for (const { userId, prediction } of entries) {
    const correction = computeScoringCorrection(prediction, wrongActual, correctActual);
    if (correction.delta === 0 &&
        correction.oldScorePoints === correction.newScorePoints &&
        correction.oldResultPoints === correction.newResultPoints) {
      continue;
    }
    plan.push({
      userId,
      prediction,
      correction,
      currentPoints: null
    });
  }

  return plan;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 * @param {number} fixtureId
 * @param {{ home: number, away: number }} wrongActual
 * @param {{ home: number, away: number }} correctActual
 * @param {{ commit?: boolean }} [options]
 * @returns {{
 *   fixtureId: number,
 *   namespace: string,
 *   wrongActual: { home: number, away: number },
 *   correctActual: { home: number, away: number },
 *   changes: Array<{
 *     userId: string,
 *     pick: string,
 *     oldTotal: number,
 *     newTotal: number,
 *     delta: number,
 *     pointsBefore: number,
 *     pointsAfter: number
 *   }>,
 *   committed: boolean
 * }}
 */
function fixFixtureScoring(db, namespace, fixtureId, wrongActual, correctActual, options = {}) {
  const entries = loadScoredPredictionsForFixture(db, namespace, fixtureId);
  if (entries.length === 0) {
    return {
      fixtureId,
      namespace,
      wrongActual,
      correctActual,
      changes: [],
      committed: false
    };
  }

  /** @type {Array<{
   *   userId: string,
   *   pick: string,
   *   oldTotal: number,
   *   newTotal: number,
   *   delta: number,
   *   pointsBefore: number,
   *   pointsAfter: number,
   *   updatedPrediction: import('./predictionGameStore').GamePrediction
   * }>} */
  const pendingChanges = [];

  for (const { userId, prediction } of entries) {
    const correction = computeScoringCorrection(prediction, wrongActual, correctActual);
    if (correction.delta === 0 &&
        prediction.scorePoints === correction.newScorePoints &&
        prediction.resultPoints === correction.newResultPoints &&
        prediction.pointsAwarded === correction.newTotal) {
      continue;
    }

    const pointsBefore = getDbValue(db, `${namespace}:points:${userId}`) || 0;
    const pointsAfter = Math.max(0, pointsBefore + correction.delta);
    pendingChanges.push({
      userId,
      pick: `${prediction.homeScore}-${prediction.awayScore} (${prediction.resultPick})`,
      oldTotal: correction.oldTotal,
      newTotal: correction.newTotal,
      delta: correction.delta,
      pointsBefore,
      pointsAfter,
      updatedPrediction: {
        ...prediction,
        scored: true,
        scorePoints: correction.newScorePoints,
        resultPoints: correction.newResultPoints,
        pointsAwarded: correction.newTotal
      }
    });
  }

  if (options.commit && pendingChanges.length > 0) {
    const setStmt = db.prepare(`
      INSERT INTO keyv (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    db.transaction(() => {
      for (const change of pendingChanges) {
        setStmt.run(
          `${namespace}:prediction:${change.userId}:${fixtureId}`,
          wrapKeyvValue(change.updatedPrediction)
        );
        setStmt.run(
          `${namespace}:points:${change.userId}`,
          wrapKeyvValue(change.pointsAfter)
        );
      }
    })();
  }

  return {
    fixtureId,
    namespace,
    wrongActual,
    correctActual,
    changes: pendingChanges.map(({ updatedPrediction, ...rest }) => rest),
    committed: Boolean(options.commit && pendingChanges.length > 0)
  };
}

module.exports = {
  parseScoreArg,
  scorePrediction,
  computeScoringCorrection,
  loadScoredPredictionsForFixture,
  planFixtureScoringCorrections,
  fixFixtureScoring,
  parseKeyvValue
};
