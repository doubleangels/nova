const Database = require('better-sqlite3');
const {
  parseScoreArg,
  scorePrediction,
  computeScoringCorrection,
  planFixtureScoringCorrections,
  parseKeyvValue,
  loadScoredPredictionsForFixture,
  loadAllPredictionsForFixture,
  getFixtureTrackingState,
  listFixtureRelatedKeys,
  detectNamespacesWithPredictions,
  scanDatabaseForFixtureId,
  discoverPredictorUserIds,
  formatLongList,
  buildFixtureScoringReport,
  formatFixtureScoringReport,
  fixFixtureScoring,
  fixFixtureScoringAll,
  resolveNamespacesToProcess,
  formatMultiNamespaceFixtureScoringReport
} = require('../../utils/fixFixtureScoring');

const FIXTURE_ID = 537371;
const NAMESPACE = 'football';
const WRONG = { home: 5, away: 1 };
const CORRECT = { home: 4, away: 1 };
const USER_A = '633344914847170562';
const USER_B = '297922307303800833';

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

  describe('fixture database reporting', () => {
    it('should collect tracking state and related keys', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:scored_fixtures`, [FIXTURE_ID, 999]);
      setKey(db, `${NAMESPACE}:prompted_fixtures`, [888]);
      setKey(db, `${NAMESPACE}:scoring_lock:${FIXTURE_ID}`, 1);
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
      setKey(db, `${NAMESPACE}:pending_prediction:111:${FIXTURE_ID}`, {
        homeScore: 1,
        awayScore: 0,
        resultPick: 'home',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });

      const tracking = getFixtureTrackingState(db, NAMESPACE, FIXTURE_ID);
      expect(tracking.inScoredFixtures).toBe(true);
      expect(tracking.inPromptedFixtures).toBe(false);
      expect(tracking.hasScoringLock).toBe(true);

      const relatedKeys = listFixtureRelatedKeys(db, NAMESPACE, FIXTURE_ID);
      expect(relatedKeys.map(entry => entry.key)).toEqual(
        expect.arrayContaining([
          `${NAMESPACE}:predictions_by_fixture:${FIXTURE_ID}`,
          `${NAMESPACE}:prediction:111:${FIXTURE_ID}`,
          `${NAMESPACE}:pending_prediction:111:${FIXTURE_ID}`,
          `${NAMESPACE}:scoring_lock:${FIXTURE_ID}`
        ])
      );

      const allPredictions = loadAllPredictionsForFixture(db, NAMESPACE, FIXTURE_ID);
      expect(allPredictions).toHaveLength(1);
      expect(allPredictions[0].pendingPrediction).toMatchObject({ homeScore: 1, awayScore: 0 });

      setKey(db, `${NAMESPACE}:user_predictions:111`, [FIXTURE_ID, 999]);
      const relatedKeysWithUserIndex = listFixtureRelatedKeys(db, NAMESPACE, FIXTURE_ID);
      expect(relatedKeysWithUserIndex.some(entry => entry.key === `${NAMESPACE}:user_predictions:111`)).toBe(true);

      const formatted = formatFixtureScoringReport(
        buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT)
      );
      expect(formatted).toContain('Pending prediction:');
    });

    it('should build a full report with unchanged and corrected users', () => {
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
      setKey(db, `${NAMESPACE}:predictions_by_fixture:${FIXTURE_ID}`, ['111', '222', '333']);
      setKey(db, `${NAMESPACE}:prediction:333:${FIXTURE_ID}`, {
        homeScore: 1,
        awayScore: 0,
        resultPick: 'home',
        scored: false,
        submittedAt: '2026-01-01T00:00:00.000Z'
      });

      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);

      expect(report.users).toHaveLength(3);
      expect(report.changes).toHaveLength(1);
      expect(report.users.find(user => user.userId === '222')?.needsCorrection).toBe(false);
      expect(report.users.find(user => user.userId === '333')?.scored).toBe(false);

      const formatted = formatFixtureScoringReport(report);
      expect(formatted).toContain('--- Database state ---');
      expect(formatted).toContain('--- Fixture-related keys');
      expect(formatted).toContain('User 111');
      expect(formatted).toContain('User 333');
      expect(formatted).toContain('Status: not scored (no correction applied)');
      expect(formatted).toContain('Needs correction: no');
      expect(formatted).toContain('Users to adjust: 1');
    });

    it('should discover predictors from prediction keys when the index is missing', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:prediction:${USER_A}:${FIXTURE_ID}`, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1,
        submittedAt: '2026-01-01T00:00:00.000Z'
      });

      expect(discoverPredictorUserIds(db, NAMESPACE, FIXTURE_ID)).toEqual([USER_A]);
      expect(loadScoredPredictionsForFixture(db, NAMESPACE, FIXTURE_ID)).toHaveLength(1);
    });

    it('should scan the full database and detect alternate namespaces', () => {
      const db = createTestDb();
      setKey(db, `worldcup:prediction:999888777666555444:${FIXTURE_ID}`, {
        homeScore: 2,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 2,
        resultPoints: 1,
        pointsAwarded: 3,
        submittedAt: '2026-01-01T00:00:00.000Z'
      });
      setKey(db, `${NAMESPACE}:fixture_scored:${FIXTURE_ID}`, true);

      const scan = scanDatabaseForFixtureId(db, FIXTURE_ID);
      expect(scan.some(entry => entry.key.startsWith('worldcup:prediction:'))).toBe(true);
      expect(detectNamespacesWithPredictions(db, FIXTURE_ID)).toEqual(['worldcup']);

      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);
      const formatted = formatFixtureScoringReport(report);
      expect(report.tracking.inScoredFixtures).toBe(true);
      expect(report.tracking.hasFixtureScoredFlag).toBe(true);
      expect(formatted).toContain('--- Database-wide scan for 537371');
      expect(formatted).toContain('Try re-running with --namespace worldcup');
      expect(formatLongList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]))
        .toContain('21 total');
      expect(formatLongList('invalid')).toBe('"invalid"');
    });

    it('should ignore invalid user ids when discovering predictors', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:predictions_by_fixture:${FIXTURE_ID}`, ['', '111']);
      setKey(db, `${NAMESPACE}:prediction:111:${FIXTURE_ID}`, {
        homeScore: 1,
        awayScore: 0,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });

      expect(discoverPredictorUserIds(db, NAMESPACE, FIXTURE_ID)).toEqual(['111']);
    });

    it('should ignore unrelated user prediction indexes', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:user_predictions:111`, 'invalid');
      setKey(db, `${NAMESPACE}:user_predictions:222`, [999]);

      expect(listFixtureRelatedKeys(db, NAMESPACE, FIXTURE_ID)).toEqual([]);
    });

    it('should classify non-prediction keys as having no namespace during scan', () => {
      const db = createTestDb();
      setKey(db, `main:config:test_${FIXTURE_ID}`, FIXTURE_ID);

      const scan = scanDatabaseForFixtureId(db, FIXTURE_ID);
      expect(scan[0].namespace).toBeNull();
    });

    it('should format an empty report when no fixture data exists', () => {
      const db = createTestDb();
      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);
      const formatted = formatFixtureScoringReport(report);

      expect(report.users).toEqual([]);
      expect(report.relatedKeys).toEqual([]);
      expect(formatted).toContain('(none indexed for this fixture)');
      expect(formatted).toContain('(no keys or values contain this fixture id)');
      expect(formatted).toContain('Verify the fixture id with /football list ft in Discord.');
      expect(formatted).toContain('No point adjustments needed.');
    });

    it('should handle invalid tracking lists and indexed users without predictions', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:scored_fixtures`, 'invalid');
      setKey(db, `${NAMESPACE}:prompted_fixtures`, 'invalid');
      setKey(db, `${NAMESPACE}:predictions_by_fixture:${FIXTURE_ID}`, ['444']);

      const tracking = getFixtureTrackingState(db, NAMESPACE, FIXTURE_ID);
      expect(tracking.inScoredFixtures).toBe(false);
      expect(tracking.scoredFixtures).toEqual([]);
      expect(tracking.promptedFixtures).toEqual([]);

      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);
      expect(report.users).toEqual([
        expect.objectContaining({
          userId: '444',
          prediction: null,
          scored: false,
          storedPoints: null
        })
      ]);
    });

    it('should format positive and negative correction deltas', () => {
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

      const formatted = formatFixtureScoringReport(
        buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT)
      );

      expect(formatted).toContain('(-2)');
      expect(formatted).toContain('(+2)');
      expect(formatted).toContain('Net points delta across all users: 0');
    });

    it('should handle scored predictions missing stored point fields', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:predictions_by_fixture:${FIXTURE_ID}`, ['111']);
      setKey(db, `${NAMESPACE}:prediction:111:${FIXTURE_ID}`, {
        homeScore: 2,
        awayScore: 0,
        resultPick: 'home',
        scored: true,
        submittedAt: '2026-01-01T00:00:00.000Z'
      });

      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);
      expect(report.users[0].storedPoints).toEqual({
        scorePoints: null,
        resultPoints: null,
        pointsAwarded: null
      });
      expect(report.changes).toHaveLength(1);
    });

    it('should format a positive net points delta', () => {
      const db = createTestDb();
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

      const formatted = formatFixtureScoringReport(
        buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT)
      );

      expect(formatted).toContain('Net points delta across all users: +2');
    });

    it('should process all namespaces with predictions when namespace is omitted', () => {
      const db = createTestDb();
      setKey(db, `worldcup:prediction:${USER_A}:${FIXTURE_ID}`, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });
      setKey(db, `worldcup:points:${USER_A}`, 5);

      const reports = fixFixtureScoringAll(db, FIXTURE_ID, WRONG, CORRECT);
      expect(reports).toHaveLength(1);
      expect(reports[0].namespace).toBe('worldcup');
      expect(reports[0].changes).toHaveLength(1);
      expect(reports[0].changes[0].userId).toBe(USER_A);
      expect(reports[0].changes[0].delta).toBe(2);
    });

    it('should explain when no exact-score pickers need adjustment', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        '111',
        {
          homeScore: 3,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        },
        4
      );

      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);
      const formatted = formatFixtureScoringReport(report);

      expect(formatted).toContain('Picked exact correct score (4-1): (none)');
      expect(formatted).toContain('Picked exact wrong score (5-1): (none)');
      expect(formatted).toContain(
        'Every scored prediction already earns the same match points against both the wrong and correct final scores.'
      );
    });

    it('should list exact-score pickers when no total adjustments are required', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        USER_A,
        {
          homeScore: 3,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        },
        10
      );

      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);
      const formatted = formatFixtureScoringReport(report);

      expect(report.changes).toHaveLength(0);
      expect(formatted).toContain('Picked exact correct score (4-1): (none)');
      expect(formatted).toContain('Picked exact wrong score (5-1): (none)');
    });

    it('should list wrong-score pickers when no adjustments are required', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        USER_A,
        {
          homeScore: 5,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        },
        3
      );

      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);
      expect(report.changes).toHaveLength(1);
      expect(report.changes[0].delta).toBe(-2);
    });

    it('should list wrong-score pickers in the no-change summary', () => {
      const db = createTestDb();
      const actual = { home: 4, away: 1 };
      seedFixturePrediction(
        db,
        USER_A,
        {
          homeScore: 4,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 2,
          resultPoints: 1,
          pointsAwarded: 3
        },
        3
      );

      const formatted = formatFixtureScoringReport(
        buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, actual, actual)
      );

      expect(formatted).toContain(`Picked exact wrong score (4-1): ${USER_A}`);
    });

    it('should award missing exact-score points when a 4-1 pick was scored against the wrong result', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        USER_A,
        {
          homeScore: 4,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        },
        10
      );

      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);

      expect(report.changes).toHaveLength(1);
      expect(report.changes[0]).toMatchObject({
        userId: USER_A,
        oldTotal: 1,
        newTotal: 3,
        delta: 2,
        pointsBefore: 10,
        pointsAfter: 12
      });
    });

    it('should include committed summary for multi-namespace reports', () => {
      const db = createTestDb();
      const report = buildFixtureScoringReport(db, NAMESPACE, FIXTURE_ID, WRONG, CORRECT);
      const summary = formatMultiNamespaceFixtureScoringReport([
        { ...report, namespace: NAMESPACE, committed: true },
        { ...report, namespace: 'worldcup', committed: true }
      ]);
      expect(summary).toContain('Changes committed.');
    });

    it('should summarize multi-namespace reports with no net changes', () => {
      const db = createTestDb();
      seedFixturePrediction(
        db,
        USER_A,
        {
          homeScore: 3,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        },
        4
      );
      setKey(db, `worldcup:prediction:${USER_B}:${FIXTURE_ID}`, {
        homeScore: 2,
        awayScore: 0,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });

      const reports = fixFixtureScoringAll(db, FIXTURE_ID, WRONG, CORRECT);
      const formatted = formatMultiNamespaceFixtureScoringReport(reports);

      expect(formatted).toContain('Total users to adjust: 0');
      expect(formatted).not.toContain('Net points delta across all users');
    });

    it('should show negative net delta in multi-namespace summary', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:prediction:${USER_A}:${FIXTURE_ID}`, {
        homeScore: 5,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 2,
        resultPoints: 1,
        pointsAwarded: 3
      });
      setKey(db, `worldcup:prediction:${USER_B}:${FIXTURE_ID}`, {
        homeScore: 2,
        awayScore: 0,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });

      const formatted = formatMultiNamespaceFixtureScoringReport(
        fixFixtureScoringAll(db, FIXTURE_ID, WRONG, CORRECT)
      );

      expect(formatted).toContain('Net points delta across all users: -2');
    });

    it('should format single-namespace report without multi summary headers', () => {
      const db = createTestDb();
      setKey(db, `worldcup:prediction:${USER_A}:${FIXTURE_ID}`, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });

      const reports = fixFixtureScoringAll(db, FIXTURE_ID, WRONG, CORRECT);
      expect(reports).toHaveLength(1);

      const formatted = formatMultiNamespaceFixtureScoringReport(reports);
      expect(formatted).not.toContain('========== Namespace:');
      expect(formatted).not.toContain('========== Summary ==========');
      expect(formatted).toContain('Users to adjust: 1');
    });

    it('should show positive net delta in multi-namespace summary', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:prediction:${USER_A}:${FIXTURE_ID}`, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });
      setKey(db, `worldcup:prediction:${USER_B}:${FIXTURE_ID}`, {
        homeScore: 2,
        awayScore: 0,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });

      const formatted = formatMultiNamespaceFixtureScoringReport(
        fixFixtureScoringAll(db, FIXTURE_ID, WRONG, CORRECT)
      );

      expect(formatted).toContain('Net points delta across all users: +2');
    });

    it('should match production fixture 537371 worldcup data (no adjustments for 5-1 vs 4-1)', () => {
      const db = createTestDb();
      const picks = [
        [1466863387534426386, 1, 0],
        [297440646661275654, 3, 2],
        [297922307303800833, 2, 0],
        [350390178788933632, 3, 1],
        [462993343228411905, 3, 0],
        [519193957054414859, 3, 0],
        [633344914847170562, 4, 0]
      ];

      for (const [userId, homeScore, awayScore] of picks) {
        setKey(db, `worldcup:prediction:${userId}:${FIXTURE_ID}`, {
          homeScore,
          awayScore,
          resultPick: 'home',
          scored: true,
          scorePoints: 0,
          resultPoints: 1,
          pointsAwarded: 1
        });
      }

      const reports = fixFixtureScoringAll(db, FIXTURE_ID, WRONG, CORRECT);
      expect(reports).toHaveLength(1);
      expect(reports[0].namespace).toBe('worldcup');
      expect(reports[0].changes).toHaveLength(0);

      const formatted = formatFixtureScoringReport(reports[0]);
      expect(formatted).toContain('Picked exact correct score (4-1): (none)');
      expect(formatted).toContain('Predictors (7)');
    });

    it('should format multi-namespace output with summary', () => {
      const db = createTestDb();
      setKey(db, `${NAMESPACE}:prediction:${USER_A}:${FIXTURE_ID}`, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });
      setKey(db, `worldcup:prediction:${USER_B}:${FIXTURE_ID}`, {
        homeScore: 5,
        awayScore: 1,
        resultPick: 'home',
        scored: true,
        scorePoints: 2,
        resultPoints: 1,
        pointsAwarded: 3
      });

      const reports = fixFixtureScoringAll(db, FIXTURE_ID, WRONG, CORRECT);
      expect(reports).toHaveLength(2);

      const formatted = formatMultiNamespaceFixtureScoringReport(reports);
      expect(formatted).toContain('========== Namespace: football ==========');
      expect(formatted).toContain('========== Namespace: worldcup ==========');
      expect(formatted).toContain('========== Summary ==========');
      expect(formatted).toContain('Total users to adjust: 2');
      expect(formatted).toContain('Net points delta across all users: 0');
      expect(formatMultiNamespaceFixtureScoringReport([])).toBe('No namespaces to process.');
    });

    it('should resolve namespaces explicitly or automatically', () => {
      const db = createTestDb();
      setKey(db, `worldcup:prediction:${USER_B}:${FIXTURE_ID}`, {
        homeScore: 1,
        awayScore: 0,
        resultPick: 'home',
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });

      expect(resolveNamespacesToProcess(db, FIXTURE_ID, 'football')).toEqual(['football']);
      expect(resolveNamespacesToProcess(db, FIXTURE_ID, undefined)).toEqual(['worldcup']);
      expect(resolveNamespacesToProcess(db, 999999, undefined)).toEqual(['football', 'worldcup']);
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
