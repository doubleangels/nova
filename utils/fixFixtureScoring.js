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
 * @param {unknown[]} list
 * @param {unknown} fixtureId
 * @returns {boolean}
 */
function listIncludesFixtureId(list, fixtureId) {
  if (!Array.isArray(list)) return false;
  const normalized = Number(fixtureId);
  return list.some(id => Number(id) === normalized);
}

/**
 * @param {import('./predictionGameStore').GamePrediction} prediction
 * @param {ReturnType<typeof computeScoringCorrection>} correction
 * @returns {boolean}
 */
function predictionMatchesCorrectedScoring(prediction, correction) {
  return (
    correction.delta === 0 &&
    prediction.scorePoints === correction.newScorePoints &&
    prediction.resultPoints === correction.newResultPoints &&
    prediction.pointsAwarded === correction.newTotal
  );
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 * @param {number} fixtureId
 * @returns {string[]}
 */
function loadPredictorUserIds(db, namespace, fixtureId) {
  const userIds = getDbValue(db, `${namespace}:predictions_by_fixture:${fixtureId}`);
  return Array.isArray(userIds) ? userIds : [];
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 * @param {number} fixtureId
 * @returns {Array<{ userId: string, prediction: import('./predictionGameStore').GamePrediction|null, pendingPrediction: import('./predictionGameStore').PendingPrediction|null, totalPoints: number }>}
 */
function loadAllPredictionsForFixture(db, namespace, fixtureId) {
  const userIds = loadPredictorUserIds(db, namespace, fixtureId);
  return userIds.map(userId => ({
    userId,
    prediction: getDbValue(db, `${namespace}:prediction:${userId}:${fixtureId}`) || null,
    pendingPrediction: getDbValue(db, `${namespace}:pending_prediction:${userId}:${fixtureId}`) || null,
    totalPoints: getDbValue(db, `${namespace}:points:${userId}`) || 0
  }));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 * @param {number} fixtureId
 * @returns {{ inScoredFixtures: boolean, inPromptedFixtures: boolean, hasScoringLock: boolean, scoredFixtures: unknown[], promptedFixtures: unknown[] }}
 */
function getFixtureTrackingState(db, namespace, fixtureId) {
  const scoredFixtures = getDbValue(db, `${namespace}:scored_fixtures`) || [];
  const promptedFixtures = getDbValue(db, `${namespace}:prompted_fixtures`) || [];
  return {
    inScoredFixtures: listIncludesFixtureId(scoredFixtures, fixtureId),
    inPromptedFixtures: listIncludesFixtureId(promptedFixtures, fixtureId),
    hasScoringLock: getDbValue(db, `${namespace}:scoring_lock:${fixtureId}`) != null,
    scoredFixtures: Array.isArray(scoredFixtures) ? scoredFixtures : [],
    promptedFixtures: Array.isArray(promptedFixtures) ? promptedFixtures : []
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 * @param {number} fixtureId
 * @returns {Array<{ key: string, value: unknown }>}
 */
function listFixtureRelatedKeys(db, namespace, fixtureId) {
  const prefix = `${namespace}:`;
  const suffix = `:${fixtureId}`;
  const rows = db.prepare(`
    SELECT key, value FROM keyv
    WHERE key = ?
       OR key = ?
       OR key LIKE ?
       OR key LIKE ?
    ORDER BY key
  `).all(
    `${prefix}predictions_by_fixture:${fixtureId}`,
    `${prefix}scoring_lock:${fixtureId}`,
    `${prefix}prediction:%${suffix}`,
    `${prefix}pending_prediction:%${suffix}`
  );

  return rows.map(row => ({
    key: row.key,
    value: parseKeyvValue(row.value)
  }));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 * @param {number} fixtureId
 * @param {{ home: number, away: number }} wrongActual
 * @param {{ home: number, away: number }} correctActual
 * @returns {{
 *   fixtureId: number,
 *   namespace: string,
 *   wrongActual: { home: number, away: number },
 *   correctActual: { home: number, away: number },
 *   tracking: ReturnType<typeof getFixtureTrackingState>,
 *   relatedKeys: ReturnType<typeof listFixtureRelatedKeys>,
 *   users: Array<{
 *     userId: string,
 *     prediction: import('./predictionGameStore').GamePrediction|null,
 *     pendingPrediction: import('./predictionGameStore').PendingPrediction|null,
 *     totalPoints: number,
 *     scored: boolean,
 *     storedPoints: { scorePoints: number|null, resultPoints: number|null, pointsAwarded: number|null }|null,
 *     againstWrong: ReturnType<typeof scorePrediction>|null,
 *     againstCorrect: ReturnType<typeof scorePrediction>|null,
 *     needsCorrection: boolean,
 *     pointsAfter: number|null
 *   }>,
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
function buildFixtureScoringReport(db, namespace, fixtureId, wrongActual, correctActual, options = {}) {
  const tracking = getFixtureTrackingState(db, namespace, fixtureId);
  const relatedKeys = listFixtureRelatedKeys(db, namespace, fixtureId);
  const predictorEntries = loadAllPredictionsForFixture(db, namespace, fixtureId);

  /** @type {ReturnType<typeof buildFixtureScoringReport>['users']} */
  const users = [];
  /** @type {ReturnType<typeof buildFixtureScoringReport>['changes']} */
  const pendingChanges = [];

  for (const entry of predictorEntries) {
    const { userId, prediction, pendingPrediction, totalPoints } = entry;
    const scored = Boolean(prediction?.scored);

    if (!scored || !prediction) {
      users.push({
        userId,
        prediction,
        pendingPrediction,
        totalPoints,
        scored: false,
        storedPoints: prediction
          ? {
              scorePoints: prediction.scorePoints ?? null,
              resultPoints: prediction.resultPoints ?? null,
              pointsAwarded: prediction.pointsAwarded ?? null
            }
          : null,
        againstWrong: null,
        againstCorrect: null,
        needsCorrection: false,
        pointsAfter: null
      });
      continue;
    }

    const correction = computeScoringCorrection(prediction, wrongActual, correctActual);
    const againstWrong = scorePrediction(prediction, wrongActual);
    const againstCorrect = scorePrediction(prediction, correctActual);
    const needsCorrection = !predictionMatchesCorrectedScoring(prediction, correction);
    const pointsAfter = needsCorrection
      ? Math.max(0, totalPoints + correction.delta)
      : totalPoints;

    users.push({
      userId,
      prediction,
      pendingPrediction,
      totalPoints,
      scored: true,
      storedPoints: {
        scorePoints: prediction.scorePoints ?? null,
        resultPoints: prediction.resultPoints ?? null,
        pointsAwarded: prediction.pointsAwarded ?? null
      },
      againstWrong,
      againstCorrect,
      needsCorrection,
      pointsAfter: needsCorrection ? pointsAfter : null
    });

    if (needsCorrection) {
      pendingChanges.push({
        userId,
        pick: `${prediction.homeScore}-${prediction.awayScore} (${prediction.resultPick})`,
        oldTotal: correction.oldTotal,
        newTotal: correction.newTotal,
        delta: correction.delta,
        pointsBefore: totalPoints,
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
    tracking,
    relatedKeys,
    users,
    changes: pendingChanges.map(({ updatedPrediction, ...rest }) => rest),
    committed: Boolean(options.commit && pendingChanges.length > 0)
  };
}

/**
 * @param {ReturnType<typeof buildFixtureScoringReport>} report
 * @returns {string}
 */
function formatFixtureScoringReport(report) {
  const lines = [];

  lines.push('--- Database state ---');
  lines.push(`Fixture tracked as scored: ${report.tracking.inScoredFixtures}`);
  lines.push(`Fixture tracked as prompted: ${report.tracking.inPromptedFixtures}`);
  lines.push(`Scoring lock present: ${report.tracking.hasScoringLock}`);
  lines.push(`Scored fixtures list (${report.tracking.scoredFixtures.length}): ${JSON.stringify(report.tracking.scoredFixtures)}`);
  lines.push(`Prompted fixtures list (${report.tracking.promptedFixtures.length}): ${JSON.stringify(report.tracking.promptedFixtures)}`);
  lines.push('');

  lines.push(`--- Fixture-related keys (${report.relatedKeys.length}) ---`);
  if (report.relatedKeys.length === 0) {
    lines.push('(none)');
  } else {
    for (const { key, value } of report.relatedKeys) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('');

  lines.push(`--- Predictors (${report.users.length}) ---`);
  if (report.users.length === 0) {
    lines.push('(none indexed for this fixture)');
  } else {
    for (const user of report.users) {
      lines.push(`User ${user.userId}`);
      lines.push(`  Total points (stored): ${user.totalPoints}`);
      lines.push(`  Prediction: ${JSON.stringify(user.prediction)}`);
      if (user.pendingPrediction) {
        lines.push(`  Pending prediction: ${JSON.stringify(user.pendingPrediction)}`);
      }
      if (!user.scored) {
        lines.push('  Status: not scored (no correction applied)');
        lines.push('');
        continue;
      }
      lines.push(`  Stored match points: ${JSON.stringify(user.storedPoints)}`);
      lines.push(`  Recalculated vs wrong score (${report.wrongActual.home}-${report.wrongActual.away}): ${JSON.stringify(user.againstWrong)}`);
      lines.push(`  Recalculated vs correct score (${report.correctActual.home}-${report.correctActual.away}): ${JSON.stringify(user.againstCorrect)}`);
      if (user.needsCorrection) {
        lines.push(`  Needs correction: yes (total points ${user.totalPoints} -> ${user.pointsAfter})`);
      } else {
        lines.push('  Needs correction: no');
      }
      lines.push('');
    }
  }

  lines.push('--- Corrections ---');
  if (report.changes.length === 0) {
    lines.push('No point adjustments needed.');
  } else {
    lines.push(`Users to adjust: ${report.changes.length}`);
    for (const change of report.changes) {
      const sign = change.delta > 0 ? '+' : '';
      lines.push(`User ${change.userId}`);
      lines.push(`  Pick: ${change.pick}`);
      lines.push(`  Match points: ${change.oldTotal} -> ${change.newTotal} (${sign}${change.delta})`);
      lines.push(`  Total points: ${change.pointsBefore} -> ${change.pointsAfter}`);
    }
    const netDelta = report.changes.reduce((sum, change) => sum + change.delta, 0);
    lines.push(`Net points delta across all users: ${netDelta > 0 ? '+' : ''}${netDelta}`);
  }

  return lines.join('\n');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} namespace
 * @param {number} fixtureId
 * @returns {Array<{ userId: string, prediction: import('./predictionGameStore').GamePrediction }>}
 */
function loadScoredPredictionsForFixture(db, namespace, fixtureId) {
  return loadAllPredictionsForFixture(db, namespace, fixtureId)
    .filter(entry => entry.prediction?.scored)
    .map(entry => ({
      userId: entry.userId,
      prediction: entry.prediction
    }));
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
    wrongActual,
    correctActual,
    loadPredictions
  } = params;

  const entries = loadPredictions
    ? loadPredictions(params.fixtureId)
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
 * @returns {ReturnType<typeof buildFixtureScoringReport>}
 */
function fixFixtureScoring(db, namespace, fixtureId, wrongActual, correctActual, options = {}) {
  return buildFixtureScoringReport(
    db,
    namespace,
    fixtureId,
    wrongActual,
    correctActual,
    options
  );
}

module.exports = {
  parseScoreArg,
  scorePrediction,
  computeScoringCorrection,
  loadPredictorUserIds,
  loadAllPredictionsForFixture,
  loadScoredPredictionsForFixture,
  getFixtureTrackingState,
  listFixtureRelatedKeys,
  buildFixtureScoringReport,
  formatFixtureScoringReport,
  planFixtureScoringCorrections,
  fixFixtureScoring,
  parseKeyvValue
};
