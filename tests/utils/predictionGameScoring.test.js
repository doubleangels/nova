const scoring = require('../../utils/predictionGameScoring');

describe('predictionGameScoring', () => {
  describe('getOutcome', () => {
    it('should return null when scores are null', () => {
      expect(scoring.getOutcome(null, 1)).toBeNull();
      expect(scoring.getOutcome(1, null)).toBeNull();
      expect(scoring.getOutcome(null, null)).toBeNull();
    });

    it('should return home when home > away', () => {
      expect(scoring.getOutcome(2, 1)).toBe('home');
    });

    it('should return away when away > home', () => {
      expect(scoring.getOutcome(0, 2)).toBe('away');
    });

    it('should return draw when scores equal', () => {
      expect(scoring.getOutcome(1, 1)).toBe('draw');
    });
  });

  describe('resultPickFromScore', () => {
    it('should return correct outcome for home win', () => {
      expect(scoring.resultPickFromScore(2, 1)).toBe('home');
    });

    it('should return draw when scores are equal (line 23 — || draw branch)', () => {
      // getOutcome(1, 1) returns 'draw', so || 'draw' is not exercised
      expect(scoring.resultPickFromScore(1, 1)).toBe('draw');
    });

    it('should fall back to draw via || when getOutcome returns null (line 23)', () => {
      // This exercises the || 'draw' fallback: getOutcome(null, null) = null → 'draw'
      // resultPickFromScore doesn't take null args in production but this exercises line 23
      expect(scoring.resultPickFromScore(null, null)).toBe('draw');
    });
  });

  describe('calculateScorePoints', () => {
    it('should return 3 for exact match', () => {
      expect(scoring.calculateScorePoints(2, 1, 2, 1)).toBe(3);
    });

    it('should return 1 for correct outcome only', () => {
      expect(scoring.calculateScorePoints(2, 0, 3, 1)).toBe(1);
    });

    it('should return 0 for wrong outcome', () => {
      expect(scoring.calculateScorePoints(2, 0, 0, 2)).toBe(0);
    });

    it('should return 0 when outcome is null (line 79 — predicted && branch false)', () => {
      // getOutcome(null, 0) = null → predicted is null → && short-circuits
      expect(scoring.calculateScorePoints(null, 0, 1, 0)).toBe(0);
    });
  });

  describe('calculateResultPoints', () => {
    it('should return 1 for correct result pick', () => {
      expect(scoring.calculateResultPoints('home', 2, 1)).toBe(1);
      expect(scoring.calculateResultPoints('draw', 1, 1)).toBe(1);
      expect(scoring.calculateResultPoints('away', 0, 3)).toBe(1);
    });

    it('should return 0 for wrong result pick', () => {
      expect(scoring.calculateResultPoints('home', 0, 2)).toBe(0);
    });

    it('should return 0 when actual outcome is null (line 103 — actual && branch false)', () => {
      expect(scoring.calculateResultPoints('home', null, null)).toBe(0);
    });
  });

  describe('alignResultPickWithScore', () => {
    it('should return resultPick when it matches the score outcome', () => {
      expect(scoring.alignResultPickWithScore(2, 1, 'home')).toBe('home');
    });

    it('should return score outcome when resultPick differs (line 61 — false ternary branch)', () => {
      // Score says home wins but resultPick is away → return fromScore
      expect(scoring.alignResultPickWithScore(2, 1, 'away')).toBe('home');
    });

    it('should handle draw alignment (line 149 — draw branch)', () => {
      expect(scoring.alignResultPickWithScore(1, 1, 'draw')).toBe('draw');
      expect(scoring.alignResultPickWithScore(1, 1, 'home')).toBe('draw');
    });
  });
});

describe('createScoreFinishedFixtures', () => {
  const scoring = require('../../utils/predictionGameScoring');

  const makeStore = (overrides = {}) => ({
    getScoredFixtures: jest.fn().mockResolvedValue([]),
    getPredictorIdsForFixture: jest.fn().mockResolvedValue([]),
    getPrediction: jest.fn().mockResolvedValue(null),
    savePrediction: jest.fn().mockResolvedValue(undefined),
    addUserPoints: jest.fn().mockResolvedValue(1),
    markFixtureScored: jest.fn().mockResolvedValue(undefined),
    ...overrides
  });

  const makeDeps = (overrides = {}) => ({
    isConfigured: jest.fn().mockReturnValue(true),
    getFixtures: jest.fn().mockResolvedValue([]),
    buildAnnouncementEmbed: jest.fn().mockReturnValue({ embeds: 'embed' }),
    logLabel: 'test',
    channelId: 'ch1',
    ...overrides
  });

  it('should return 0 when not configured', async () => {
    const store = makeStore();
    const deps = makeDeps({ isConfigured: jest.fn().mockReturnValue(false) });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    expect(await scoreFinished(null)).toBe(0);
  });

  it('should return 0 when scoringInFlight (line 79)', async () => {
    const store = makeStore();
    let resolveFixtures;
    const fixturesPromise = new Promise(r => { resolveFixtures = r; });
    const deps = makeDeps({ getFixtures: jest.fn().mockReturnValue(fixturesPromise) });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);

    const first = scoreFinished(null); // starts, sets scoringInFlight=true
    const second = scoreFinished(null); // should return 0 immediately
    resolveFixtures([]); // resolve the first call

    expect(await second).toBe(0);
    await first; // cleanup
  });

  it('should skip already-scored fixture (line 103)', async () => {
    const fixture = { id: 1, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      getScoredFixtures: jest.fn()
        .mockResolvedValueOnce([]) // initial filter
        .mockResolvedValueOnce([1]) // loop check → fixture already scored
    });
    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture])
    });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    const count = await scoreFinished(null);
    expect(count).toBe(0); // fixture was skipped, markFixtureScored not called
  });

  it('should score predictors and post announcement when earners exist (line 149)', async () => {
    const fixture = { id: 2, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      getScoredFixtures: jest.fn()
        .mockResolvedValueOnce([]) // initial filter
        .mockResolvedValueOnce([]), // loop check
      getPredictorIdsForFixture: jest.fn().mockResolvedValue(['user1']),
      getPrediction: jest.fn().mockResolvedValue({
        homeScore: 2, awayScore: 1, resultPick: 'home', scored: false
      })
    });
    const mockChannel = { isTextBased: jest.fn().mockReturnValue(true), send: jest.fn().mockResolvedValue(undefined) };
    const mockClient = { channels: { fetch: jest.fn().mockResolvedValue(mockChannel) } };


    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture])
    });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    const count = await scoreFinished(mockClient);
    expect(count).toBe(1);
    expect(mockChannel.send).toHaveBeenCalled();
  });

  it('should not post announcement if channel is not text-based (line 149 false branch)', async () => {
    const fixture = { id: 3, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      getPredictorIdsForFixture: jest.fn().mockResolvedValue(['user1']),
      getPrediction: jest.fn().mockResolvedValue({
        homeScore: 2, awayScore: 1, resultPick: 'home', scored: false
      })
    });
    const mockChannel = { isTextBased: jest.fn().mockReturnValue(false), send: jest.fn() };
    const mockClient = { channels: { fetch: jest.fn().mockResolvedValue(mockChannel) } };


    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture])
    });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    const count = await scoreFinished(mockClient);
    expect(count).toBe(1);
    expect(mockChannel.send).not.toHaveBeenCalled();
  });

  it('should catch and log error if announcement posting fails (line 154)', async () => {
    const fixture = { id: 4, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      getPredictorIdsForFixture: jest.fn().mockResolvedValue(['user1']),
      getPrediction: jest.fn().mockResolvedValue({
        homeScore: 2, awayScore: 1, resultPick: 'home', scored: false
      })
    });
    const mockChannel = { isTextBased: jest.fn().mockReturnValue(true), send: jest.fn().mockRejectedValue(new Error('Discord err')) };
    const mockClient = { channels: { fetch: jest.fn().mockResolvedValue(mockChannel) } };


    const mockLogger = { error: jest.fn() };
    jest.doMock('../../logger', () => () => mockLogger);
    
    const localScoring = require('../../utils/predictionGameScoring');
    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture])
    });
    const scoreFinished = localScoring.createScoreFinishedFixtures(store, deps);
    const count = await scoreFinished(mockClient);
    expect(count).toBe(1);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
