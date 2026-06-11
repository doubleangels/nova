describe('predictionGameStore', () => {
  let store;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }));
    jest.doMock('../../config', () => ({
      predictionPendingTtlMs: 600000,
      predictionMockApi: true
    }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    store = createPredictionStore('test-prediction-store', 'Test');
  });

  it('should include users with points on the leaderboard even when not registered', async () => {
    await store.savePrediction('role-only-user', 1, {
      homeScore: 1,
      awayScore: 0,
      resultPick: 'home',
      submittedAt: new Date().toISOString(),
      scored: true,
      pointsAwarded: 3
    });
    await store.addUserPoints('role-only-user', 3);

    const board = await store.getLeaderboard(10);
    expect(board.some(e => e.userId === 'role-only-user' && e.points === 3)).toBe(true);
  });

  it('should subtract points when clearing mock demo predictions', async () => {
    await store.savePrediction('user-a', 900001, {
      homeScore: 2,
      awayScore: 1,
      resultPick: 'home',
      submittedAt: new Date().toISOString(),
      scored: true,
      pointsAwarded: 3
    });
    await store.addUserPoints('user-a', 3);

    await store.resetMockDemoState([900001], 'worldcup');

    expect(await store.getUserPoints('user-a')).toBe(0);
    expect(await store.getPrediction('user-a', 900001)).toBeNull();
  });

  it('should set and clear prompting paused flag', async () => {
    await store.setPromptingPaused(true);
    expect(await store.isPromptingPaused()).toBe(true);

    await store.setPromptingPaused(false);
    expect(await store.isPromptingPaused()).toBe(false);
  });

  it('should save, get, and clear a pending prediction', async () => {
    await store.savePendingPrediction('user-b', 42, { homeScore: 1 });
    const pending = await store.getPendingPrediction('user-b', 42);
    expect(pending?.homeScore).toBe(1);

    await store.clearPendingPrediction('user-b', 42);
    const cleared = await store.getPendingPrediction('user-b', 42);
    expect(cleared).toBeNull();
  });

  it('should merge partial updates in savePendingPrediction', async () => {
    await store.savePendingPrediction('user-c', 55, { homeScore: 2 });
    await store.savePendingPrediction('user-c', 55, { awayScore: 0 });
    const pending = await store.getPendingPrediction('user-c', 55);
    expect(pending?.homeScore).toBe(2);
    expect(pending?.awayScore).toBe(0);
  });

  it('should skip resetMockDemoState when predictionMockApi is false', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ predictionMockApi: false, predictionPendingTtlMs: 600000 }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const nonMockStore = createPredictionStore('no-mock-store', 'NoMock');
    // Should resolve without error and without doing anything
    await expect(nonMockStore.resetMockDemoState([1, 2], 'club')).resolves.toBeUndefined();
  });

  it('should return false from areAllMockPlayableFixturesPredicted when predictionMockApi is false', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ predictionMockApi: false, predictionPendingTtlMs: 600000 }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const nonMockStore = createPredictionStore('no-mock-store-2', 'NoMock2');
    const result = await nonMockStore.areAllMockPlayableFixturesPredicted([1, 2]);
    expect(result).toBe(false);
  });

  it('should not track participant when adding 0 points (line 129 false branch)', async () => {
    await store.addUserPoints('user-zero', 0);
    expect(await store.getUserPoints('user-zero')).toBe(0);
    // User should not appear in participants since next <= 0
    const board = await store.getLeaderboard(10);
    expect(board.some(e => e.userId === 'user-zero')).toBe(false);
  });

  it('should getLeaderboard when no participants or registered users (line 213 || [])', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ predictionMockApi: true, predictionPendingTtlMs: 600000 }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const emptyStore = createPredictionStore('empty-store', 'Empty');
    const board = await emptyStore.getLeaderboard(5);
    expect(board).toEqual([]);
  });

  it('should return null from isPendingPredictionComplete for null (via store export)', () => {
    const { isPendingPredictionComplete } = require('../../utils/predictionGameStore');
    expect(isPendingPredictionComplete(null)).toBe(false);
    expect(isPendingPredictionComplete({ homeScore: 1, awayScore: 0, resultPick: 'home' })).toBe(true);
    expect(isPendingPredictionComplete({ homeScore: 1 })).toBe(false);
  });

  it('should batch-fetch predictions for a user and fixture', async () => {
    await store.savePrediction('user-batch', 10, {
      homeScore: 1,
      awayScore: 0,
      resultPick: 'home',
      submittedAt: new Date().toISOString()
    });
    await store.savePrediction('user-other', 10, {
      homeScore: 0,
      awayScore: 0,
      resultPick: 'draw',
      submittedAt: new Date().toISOString()
    });

    const userPredictions = await store.getPredictionsForUser('user-batch', [10, 99]);
    expect(userPredictions).toEqual([
      expect.objectContaining({ fixtureId: 10, prediction: expect.objectContaining({ homeScore: 1 }) }),
      { fixtureId: 99, prediction: null }
    ]);

    const fixturePredictions = await store.getPredictionsForFixture(10);
    expect(fixturePredictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'user-batch' }),
        expect.objectContaining({ userId: 'user-other' })
      ])
    );
  });

  it('should ignore duplicate prompted fixture ids', async () => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const freshStore = createPredictionStore('dup-prompt-store', 'Dup');

    await freshStore.markFixturePrompted(77);
    await freshStore.markFixturePrompted(77);

    expect(await freshStore.getPromptedFixtures()).toEqual([77]);
  });

  it('should claim a fixture for prompt only once', async () => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const claimStore = createPredictionStore('claim-prompt-store', 'Claim');

    expect(await claimStore.tryClaimFixtureForPrompt(42)).toBe(true);
    expect(await claimStore.tryClaimFixtureForPrompt(42)).toBe(false);
    expect(await claimStore.getPromptedFixtures()).toEqual([42]);
  });

  it('should release prompt claim and allow reclaim', async () => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const claimStore = createPredictionStore('release-prompt-store', 'Release');

    expect(await claimStore.tryClaimFixtureForPrompt(88)).toBe(true);
    await claimStore.releaseFixturePromptClaim(88);
    expect(await claimStore.getPromptedFixtures()).toEqual([]);
    expect(await claimStore.tryClaimFixtureForPrompt(88)).toBe(true);
  });

  it('should reject invalid fixture ids for prompt claims', async () => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const claimStore = createPredictionStore('invalid-prompt-store', 'Invalid');

    expect(await claimStore.tryClaimFixtureForPrompt('not-a-number')).toBe(false);
    expect(await claimStore.releaseFixturePromptClaim('not-a-number')).toBeUndefined();
    await claimStore.markFixturePrompted('not-a-number');
    expect(await claimStore.getPromptedFixtures()).toEqual([]);
  });

  it('should no-op when releasing a prompt claim that was never made', async () => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const claimStore = createPredictionStore('release-missing-store', 'ReleaseMissing');

    await claimStore.releaseFixturePromptClaim(404);
    expect(await claimStore.getPromptedFixtures()).toEqual([]);
  });

  it(
    'should prune prompted_fixtures when claiming beyond the cap',
    async () => {
      jest.resetModules();
      jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
      jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
      const { createPredictionStore, MAX_TRACKED_FIXTURES } = require('../../utils/predictionGameStore');
      const claimStore = createPredictionStore('claim-cap-store', 'ClaimCap');

      for (let i = 0; i < MAX_TRACKED_FIXTURES + 5; i++) {
        expect(await claimStore.tryClaimFixtureForPrompt(i)).toBe(true);
      }
      const prompted = await claimStore.getPromptedFixtures();
      expect(prompted).toHaveLength(MAX_TRACKED_FIXTURES);
      expect(prompted[0]).toBe(5);
      expect(prompted[prompted.length - 1]).toBe(MAX_TRACKED_FIXTURES + 4);
    },
    120000
  );

  it('should normalize string and number fixture ids for prompt claims', async () => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
    const { createPredictionStore } = require('../../utils/predictionGameStore');
    const claimStore = createPredictionStore('normalize-prompt-store', 'Normalize');

    expect(await claimStore.tryClaimFixtureForPrompt('12345')).toBe(true);
    expect(await claimStore.tryClaimFixtureForPrompt(12345)).toBe(false);
    expect(await claimStore.getPromptedFixtures()).toEqual([12345]);
  });

  it(
    'should prune prompted_fixtures when the cap is exceeded',
    async () => {
      jest.resetModules();
      jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
      jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
      const { createPredictionStore, MAX_TRACKED_FIXTURES } = require('../../utils/predictionGameStore');
      const capStore = createPredictionStore('cap-prompt-store', 'Cap');

      for (let i = 0; i < MAX_TRACKED_FIXTURES + 5; i++) {
        await capStore.markFixturePrompted(i);
      }
      const prompted = await capStore.getPromptedFixtures();
      expect(prompted).toHaveLength(MAX_TRACKED_FIXTURES);
      expect(prompted[0]).toBe(5);
      expect(prompted[prompted.length - 1]).toBe(MAX_TRACKED_FIXTURES + 4);
    },
    120000
  );

  it('should prune scored_fixtures when the cap is exceeded', async () => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    jest.doMock('../../config', () => ({ predictionPendingTtlMs: 600000, predictionMockApi: false }));
    const { createPredictionStore, MAX_TRACKED_FIXTURES } = require('../../utils/predictionGameStore');
    const capStore = createPredictionStore('cap-scored-store', 'ScoredCap');

    for (let i = 0; i < MAX_TRACKED_FIXTURES + 5; i++) {
      await capStore.markFixtureScored(i);
    }
    const scored = await capStore.getScoredFixtures();
    expect(scored).toHaveLength(MAX_TRACKED_FIXTURES);
    expect(scored[0]).toBe(5);
    expect(scored[scored.length - 1]).toBe(MAX_TRACKED_FIXTURES + 4);
  });

  it('should apply fixture scoring results atomically', async () => {
    await store.applyFixtureScoringResults(42, [{
      userId: 'user-score',
      prediction: {
        homeScore: 2,
        awayScore: 1,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        scorePoints: 2,
        resultPoints: 1,
        pointsAwarded: 3
      },
      pointsDelta: 3
    }]);

    expect(await store.getUserPoints('user-score')).toBe(3);
    expect(await store.getScoredFixtures()).toContain(42);
    const saved = await store.getPrediction('user-score', 42);
    expect(saved.scored).toBe(true);
    expect(saved.pointsAwarded).toBe(3);
  });

  it('should mark a fixture scored even when there are no prediction updates', async () => {
    await store.applyFixtureScoringResults(55, []);
    expect(await store.getScoredFixtures()).toContain(55);
  });

  it('should recover from corrupted registered list JSON during addRegisteredUser', async () => {
    const { getWritableDb } = require('../../utils/sqliteStore');
    const db = getWritableDb();
    db.exec('CREATE TABLE IF NOT EXISTS keyv (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare(`
      INSERT INTO keyv (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('test-prediction-store:registered', 'not-json');

    await store.addRegisteredUser('user-corrupt');

    expect(await store.getRegisteredUserIds()).toContain('user-corrupt');
  });

  it('should read unwrapped JSON arrays from keyv during transactional updates', async () => {
    const { getWritableDb } = require('../../utils/sqliteStore');
    const db = getWritableDb();
    db.exec('CREATE TABLE IF NOT EXISTS keyv (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare(`
      INSERT INTO keyv (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('test-prediction-store:registered', JSON.stringify(['user-existing']));

    await store.addRegisteredUser('user-new');

    expect(await store.getRegisteredUserIds()).toEqual(['user-existing', 'user-new']);
  });

  it('should acquire and release scoring locks', async () => {
    expect(await store.tryAcquireScoringLock(99)).toBe(true);
    expect(await store.tryAcquireScoringLock(99)).toBe(false);
    await store.releaseScoringLock(99);
    expect(await store.tryAcquireScoringLock(99)).toBe(true);
  });

  it('should skip duplicate participant tracking when adding points again', async () => {
    await store.addUserPoints('user-dup', 2);
    await store.addUserPoints('user-dup', 3);

    expect(await store.getUserPoints('user-dup')).toBe(5);
    const participants = await store.keyv.get('all_participants');
    expect(participants.filter(id => id === 'user-dup')).toHaveLength(1);
  });

  it('should initialize all_participants when tracking the first participant', async () => {
    const { getWritableDb } = require('../../utils/sqliteStore');
    const db = getWritableDb();
    db.prepare('DELETE FROM keyv WHERE key = ?').run('test-prediction-store:all_participants');

    await store.addUserPoints('first-participant', 1);

    expect(await store.keyv.get('all_participants')).toEqual(['first-participant']);
  });

  it('should add participant during scoring when all_participants is unset', async () => {
    const { getWritableDb } = require('../../utils/sqliteStore');
    const db = getWritableDb();
    db.prepare('DELETE FROM keyv WHERE key = ?').run('test-prediction-store:all_participants');

    await store.applyFixtureScoringResults(88, [{
      userId: 'scored-newbie',
      prediction: {
        homeScore: 1,
        awayScore: 0,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        pointsAwarded: 2
      },
      pointsDelta: 2
    }]);

    expect(await store.keyv.get('all_participants')).toEqual(['scored-newbie']);
    expect(await store.getUserPoints('scored-newbie')).toBe(2);
  });

  it('should not add participant during scoring when user is already tracked', async () => {
    await store.addRegisteredUser('user-tracked');

    await store.applyFixtureScoringResults(88, [{
      userId: 'user-tracked',
      prediction: {
        homeScore: 1,
        awayScore: 0,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        pointsAwarded: 2
      },
      pointsDelta: 2
    }]);

    const participants = await store.keyv.get('all_participants');
    expect(participants.filter(id => id === 'user-tracked')).toHaveLength(1);
    expect(await store.getUserPoints('user-tracked')).toBe(2);
  });

  it('should skip participant tracking when scoring leaves non-positive total points', async () => {
    const { getWritableDb } = require('../../utils/sqliteStore');
    const db = getWritableDb();
    db.exec('CREATE TABLE IF NOT EXISTS keyv (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare(`
      INSERT INTO keyv (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('test-prediction-store:points:user-negative', JSON.stringify({ value: -10, expires: null }));

    await store.applyFixtureScoringResults(91, [{
      userId: 'user-negative',
      prediction: {
        homeScore: 0,
        awayScore: 0,
        resultPick: 'draw',
        submittedAt: new Date().toISOString(),
        scored: true,
        pointsAwarded: 3
      },
      pointsDelta: 3
    }]);

    expect(await store.getUserPoints('user-negative')).toBe(-7);
    const participants = await store.keyv.get('all_participants');
    expect(participants ?? []).not.toContain('user-negative');
  });

  it('should getAllPredictorUserIds from user_predictions keys', async () => {
    await store.savePrediction('predictor-a', 10, {
      homeScore: 1,
      awayScore: 0,
      resultPick: 'home',
      submittedAt: new Date().toISOString()
    });
    await store.savePrediction('predictor-b', 11, {
      homeScore: 0,
      awayScore: 0,
      resultPick: 'draw',
      submittedAt: new Date().toISOString()
    });
    await store.keyv.set('user_predictions:empty-user', []);

    const userIds = await store.getAllPredictorUserIds();
    expect(userIds).toEqual(expect.arrayContaining(['predictor-a', 'predictor-b']));
    expect(userIds).not.toContain('empty-user');
  });

  it('should ignore malformed user_predictions keys without a user id', async () => {
    const db = require('../../utils/sqliteStore').getWritableDb();
    db.prepare(`
      INSERT INTO keyv (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(
      'test-prediction-store:user_predictions:',
      JSON.stringify({ value: [99], expires: null })
    );

    const userIds = await store.getAllPredictorUserIds();
    expect(userIds).not.toContain('');
  });

  it('should remove all user data including predictions, points, pending, and registration', async () => {
    const userId = '123456789012345678';
    const otherUserId = '987654321098765432';

    await store.addRegisteredUser(userId);
    await store.savePrediction(userId, 42, {
      homeScore: 1,
      awayScore: 0,
      resultPick: 'home',
      submittedAt: new Date().toISOString()
    });
    await store.addUserPoints(userId, 3);
    await store.savePendingPrediction(userId, 99, { homeScore: 2 });
    await store.savePrediction(otherUserId, 42, {
      homeScore: 2,
      awayScore: 1,
      resultPick: 'home',
      submittedAt: new Date().toISOString()
    });

    const summary = await store.removeUser(userId);

    expect(summary).toEqual({
      hadData: true,
      wasRegistered: true,
      predictionCount: 1,
      pendingCount: 1,
      points: 3
    });
    expect(await store.isUserRegistered(userId)).toBe(false);
    expect(await store.getUserPoints(userId)).toBe(0);
    expect(await store.getPrediction(userId, 42)).toBeNull();
    expect(await store.getPendingPrediction(userId, 99)).toBeNull();
    expect(await store.getUserPredictionFixtureIds(userId)).toEqual([]);
    expect(await store.getPredictorIdsForFixture(42)).toEqual([otherUserId]);

    const board = await store.getLeaderboard(10);
    expect(board.some(entry => entry.userId === userId)).toBe(false);
  });

  it('should return hadData false when removing an unknown user', async () => {
    const summary = await store.removeUser('999999999999999999');
    expect(summary.hadData).toBe(false);
    expect(summary.wasRegistered).toBe(false);
    expect(summary.predictionCount).toBe(0);
    expect(summary.pendingCount).toBe(0);
    expect(summary.points).toBe(0);
  });

  it('should delete predictions_by_fixture index when user is the sole predictor', async () => {
    const userId = '111111111111111111';
    await store.savePrediction(userId, 77, {
      homeScore: 1,
      awayScore: 0,
      resultPick: 'home',
      submittedAt: new Date().toISOString()
    });
    expect(await store.getPredictorIdsForFixture(77)).toEqual([userId]);

    await store.removeUser(userId);

    expect(await store.getPredictorIdsForFixture(77)).toEqual([]);
  });

  it('should remove a user who only has a zero-point record', async () => {
    const userId = '222222222222222222';
    await store.addUserPoints(userId, 0);

    const summary = await store.removeUser(userId);

    expect(summary.hadData).toBe(true);
    expect(summary.points).toBe(0);
    expect(await store.getUserPoints(userId)).toBe(0);
  });

  it('should remove a participant who was never registered', async () => {
    const userId = '333333333333333333';
    await store.savePrediction(userId, 88, {
      homeScore: 0,
      awayScore: 0,
      resultPick: 'draw',
      submittedAt: new Date().toISOString()
    });

    const summary = await store.removeUser(userId);

    expect(summary.hadData).toBe(true);
    expect(summary.wasRegistered).toBe(false);
    expect(summary.predictionCount).toBe(1);
  });

  it('should tolerate a missing predictions_by_fixture index during removal', async () => {
    const userId = '444444444444444444';
    await store.savePrediction(userId, 66, {
      homeScore: 2,
      awayScore: 2,
      resultPick: 'draw',
      submittedAt: new Date().toISOString()
    });
    await store.keyv.delete('predictions_by_fixture:66');

    const summary = await store.removeUser(userId);

    expect(summary.predictionCount).toBe(1);
    expect(await store.getPrediction(userId, 66)).toBeNull();
  });

  it('should tolerate a non-array predictions_by_fixture index during removal', async () => {
    const userId = '555555555555555555';
    await store.savePrediction(userId, 67, {
      homeScore: 1,
      awayScore: 1,
      resultPick: 'draw',
      submittedAt: new Date().toISOString()
    });
    await store.keyv.set('predictions_by_fixture:67', 'invalid');

    const summary = await store.removeUser(userId);

    expect(summary.predictionCount).toBe(1);
    expect(await store.getPrediction(userId, 67)).toBeNull();
  });

  it('should handle removeUser when registered and participant lists exist without the user', async () => {
    await store.keyv.set('registered', ['999999999999999999']);
    await store.keyv.set('all_participants', ['999999999999999999']);

    const summary = await store.removeUser('123456789012345678');

    expect(summary.hadData).toBe(false);
    expect(await store.getRegisteredUserIds()).toEqual(['999999999999999999']);
  });

  it('should treat non-array registered and participant values as empty lists', async () => {
    await store.keyv.set('registered', 'invalid');
    await store.keyv.set('all_participants', 123);
    await store.keyv.set('points:123456789012345678', 4);

    const summary = await store.removeUser('123456789012345678');

    expect(summary.hadData).toBe(true);
    expect(summary.points).toBe(4);
  });
});
