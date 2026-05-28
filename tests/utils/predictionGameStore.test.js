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
});
