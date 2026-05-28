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
});
