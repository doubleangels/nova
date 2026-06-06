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
      pointsAwarded: 4
    });
    await store.addUserPoints('user-a', 4);

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

  it('should prune prompted_fixtures when the cap is exceeded', async () => {
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
        scorePoints: 3,
        resultPoints: 1,
        pointsAwarded: 4
      },
      pointsDelta: 4
    }]);

    expect(await store.getUserPoints('user-score')).toBe(4);
    expect(await store.getScoredFixtures()).toContain(42);
    const saved = await store.getPrediction('user-score', 42);
    expect(saved.scored).toBe(true);
    expect(saved.pointsAwarded).toBe(4);
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
});
