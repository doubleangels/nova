const Database = require('better-sqlite3');
const {
  parseScoreArg,
  scorePrediction,
  computeScoringCorrection,
  planFixtureScoringCorrections,
  parseKeyvValue,
  loadScoredPredictionsForFixture,
  fixFixtureScoring
} = require('../../utils/fixFixtureScoring');

const FIXTURE_ID = 537371;
const NAMESPACE = 'football';
const WRONG = { home: 5, away: 1 };
const CORRECT = { home: 4, away: 1 };

function createTestDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE keyv (key TEXT PRIMARY KEY, value TEXT)');
  return db;
}

function setKey(db, key, value) {
  db.prepare(`
    INSERT INTO keyv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify({ value, expires: null }));
}

function seedFixturePrediction(db, userId, prediction, points = 0) {
  const indexKey = `${NAMESPACE}:predictions_by_fixture:${FIXTURE_ID}`;
  const existing = parseKeyvValue(
    db.prepare('SELECT value FROM keyv WHERE key = ?').get(indexKey)?.value
  ) || [];
  if (!existing.includes(userId)) {
    existing.push(userId);
    setKey(db, indexKey, existing);
  }
  setKey(db, `${NAMESPACE}:prediction:${userId}:${FIXTURE_ID}`, prediction);
  if (points > 0) {
    setKey(db, `${NAMESPACE}:points:${userId}`, points);
  }
}

describe('fixFixtureScoring', () => {
  describe('parseScoreArg', () => {
    it('should parse score strings', () => {
      expect(parseScoreArg('5-1')).toEqual({ home: 5, away: 1 });
      expect(parseScoreArg('4 - 1')).toEqual({ home: 4, away: 1 });
    });

    it('should reject invalid score strings', () => {
      expect(() => parseScoreArg('five-one')).toThrow(/Invalid score/);
    });
  });

  describe('parseKeyvValue', () => {
    it('should return null for missing or invalid values', () => {
      expect(parseKeyvValue(null)).toBeNull();
      expect(parseKeyvValue(undefined)).toBeNull();
      expect(parseKeyvValue('not-json')).toBeNull();
    });

    it('should unwrap keyv value envelopes', () => {
      expect(parseKeyvValue(JSON.stringify({ value: { scored: true }, expires: null }))).toEqual({
        scored: true
      });
      expect(parseKeyvValue(JSON.stringify({ scored: true }))).toEqual({ scored: true });
    });
  });

  describe('scorePrediction', () => {
    it('should combine score and result points', () => {
      expect(
        scorePrediction(
          { homeScore: 4, awayScore: 1, resultPick: 'home' },
          { home: 4, away: 1 }
        )
      ).toEqual({ scorePoints: 2, resultPoints: 1, total: 3 });
    });
  });

  describe('computeScoringCorrection for match 537371 (5-1 vs 4-1)', () => {
    it('should remove exact-score points from users who picked 5-1', () => {
      const correction = computeScoringCorrection(
        { homeScore: 5, awayScore: 1, resultPick: 'home' },
        WRONG,
        CORRECT
      );
      expect(correction.oldTotal).toBe(3);
      expect(correction.newTotal).toBe(1);
      expect(correction.delta).toBe(-2);
    });

    it('should award exact-score points to users who picked 4-1', () => {
      const correction = computeScoringCorrection(
        { homeScore: 4, awayScore: 1, resultPick: 'home' },
        WRONG,
        CORRECT
      );
      expect(correction.oldTotal).toBe(1);
      expect(correction.newTotal).toBe(3);
      expect(correction.delta).toBe(2);
    });

    it('should leave other home-win picks unchanged', () => {
      const correction = computeScoringCorrection(
        { homeScore: 3, awayScore: 0, resultPick: 'home' },
        WRONG,
        CORRECT
      );
      expect(correction.oldTotal).toBe(1);
      expect(correction.newTotal).toBe(1);
      expect(correction.delta).toBe(0);
    });
  });

  describe('planFixtureScoringCorrections', () => {
    it('should return an empty plan when no loader is provided', () => {
      expect(
        planFixtureScoringCorrections({
          fixtureId: FIXTURE_ID,
          wrongActual: WRONG,
          correctActual: CORRECT
        })
      ).toEqual([]);
    });

    it('should only include users whose totals change', () => {
      const plan = planFixtureScoringCorrections({
        fixtureId: FIXTURE_ID,
        wrongActual: WRONG,
        correctActual: CORRECT,
        loadPredictions: () => [
          {
            userId: '111',
            prediction: {
              homeScore: 5,
              awayScore: 1,
              resultPick: 'home',
              scored: true,
              scorePoints: 2,
              resultPoints: 1,
              pointsAwarded: 3
            }
          },
          {
            userId: '222',
            prediction: {
              homeScore: 2,
              awayScore: 0,
              resultPick: 'home',
              scored: true,
              scorePoints: 0,
              resultPoints: 1,
              pointsAwarded: 1
            }
          },
          {
            userId: '333',
            prediction: {
              homeScore: 4,
              awayScore: 1,
              resultPick: 'home',
              scored: true,
              scorePoints: 0,
              resultPoints: 1,
              pointsAwarded: 1
            }
          }
        ]
      });

      expect(plan).toHaveLength(2);
      expect(plan.map(entry => entry.userId).sort()).toEqual(['111', '333']);
      expect(plan.find(entry => entry.userId === '111')?.correction.delta).toBe(-2);
      expect(plan.find(entry => entry.userId === '333')?.correction.delta).toBe(2);
    });
  });

  describe('loadScoredPredictionsForFixture', () => {
    it('should ignore missing indexes, non-array indexes, and unscored predictions', () => {
      const db = createTestDb();

      expect(loadScoredPredictionsForFixture(db, NAMESPACE, FIXTURE_ID)).toEqual([]);

      setKey(db, `${NAMESPACE}:predictions_by_fixture:${FIXTURE_ID}`, 'invalid');
      expect(loadScoredPredictionsForFixture(db, NAMESPACE, FIXTURE_ID)).toEqual([]);

      setKey(db, `${NAMESPACE}:predictions_by_fixture:${FIXTURE_ID}`, ['111']);
      setKey(db, `${NAMESPACE}:prediction:111:${FIXTURE_ID}`, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        scored: false
      });
      expect(loadScoredPredictionsForFixture(db, NAMESPACE, FIXTURE_ID)).toEqual([]);
    });

    it('should return scored predictions for indexed users', () => {
      const db = createTestDb();
      const prediction = {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      };
      seedFixturePrediction(db, '111', prediction, 5);

      expect(loadScoredPredictionsForFixture(db, NAMESPACE, FIXTURE_ID)).toEqual([
        { userId: '111', prediction }
      ]);
    });
  });

  describe('fixFixtureScoring', () => {
    it('should return no changes when there are no scored predictions', () => {
      const db = createTestDb();
      const result = fixFixtureScoring(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);

      expect(result.changes).toEqual([]);
      expect(result.committed).toBe(false);
    });

    it('should preview corrections without writing when commit is false', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        '111',
        {
          homeScore: 5,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 2,
          resultPoints: 1,
          pointsAwarded: 3
        },
        8
      );
      seedFixturePrediction(
        db,
        '222',
        {
          homeScore: 2,
          awayScore: 0,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        },
        4
      );

      const result = fixFixtureScoring(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);

      expect(result.changes).toEqual([
        expect.objectContaining({
          userId: '111',
          oldTotal: 3,
          newTotal: 1,
          delta: -2,
          pointsBefore: 8,
          pointsAfter: 6
        })
      ]);
      expect(result.committed).toBe(false);
      expect(parseKeyvValue(
        db.prepare('SELECT value FROM keyv WHERE key = ?').get(`${NAMESPACE}:points:111`).value
      )).toBe(8);
    });

    it('should treat missing user points as zero when previewing corrections', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        '111',
        {
          homeScore: 4,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        }
      );

      const result = fixFixtureScoring(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);

      expect(result.changes).toEqual([
        expect.objectContaining({
          userId: '111',
          pointsBefore: 0,
          pointsAfter: 2
        })
      ]);
    });

    it('should skip users whose stored prediction already matches the corrected score', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        '111',
        {
          homeScore: 2,
          awayScore: 0,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        },
        10
      );

      const result = fixFixtureScoring(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);

      expect(result.changes).toEqual([]);
      expect(result.committed).toBe(false);
    });

    it('should commit corrected predictions and clamp total points at zero', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        '111',
        {
          homeScore: 5,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 2,
          resultPoints: 1,
          pointsAwarded: 3
        },
        1
      );
      seedFixturePrediction(
        db,
        '333',
        {
          homeScore: 4,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        },
        2
      );

      const result = fixFixtureScoring(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT, { commit: true });

      expect(result.committed).toBe(true);
      expect(result.changes).toHaveLength(2);
      expect(result.changes.find(change => change.userId === '111')).toMatchObject({
        pointsBefore: 1,
        pointsAfter: 0
      });
      expect(result.changes.find(change => change.userId === '333')).toMatchObject({
        pointsBefore: 2,
        pointsAfter: 4
      });

      expect(parseKeyvValue(
        db.prepare('SELECT value FROM keyv WHERE key = ?').get(`${NAMESPACE}:points:111`).value
      )).toBe(0);
      expect(parseKeyvValue(
        db.prepare('SELECT value FROM keyv WHERE key = ?').get(`${NAMESPACE}:points:333`).value
      )).toBe(4);
      expect(parseKeyvValue(
        db.prepare('SELECT value FROM keyv WHERE key = ?')
          .get(`${NAMESPACE}:prediction:333:${FIXTURE_ID}`).value
      )).toMatchObject({
        scorePoints: 2,
        resultPoints: 1,
        pointsAwarded: 3
      });
    });
  });
});
