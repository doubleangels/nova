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
    it('should return 2 for exact match', () => {
      expect(scoring.calculateScorePoints(2, 1, 2, 1)).toBe(2);
    });

    it('should return 0 when scoreline outcome matches but numbers differ', () => {
      expect(scoring.calculateScorePoints(2, 0, 3, 1)).toBe(0);
      expect(scoring.calculateScorePoints(1, 1, 0, 0)).toBe(0);
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

  describe('buildFixtureRescoreUpdates', () => {
    it('should lower totals when the old outcome-only score point is removed', () => {
      const updates = scoring.buildFixtureRescoreUpdates(
        [
          {
            userId: 'user-a',
            prediction: {
              homeScore: 1,
              awayScore: 0,
              resultPick: 'home',
              submittedAt: '2026-06-11T12:00:00.000Z',
              scored: true,
              scorePoints: 1,
              resultPoints: 1,
              pointsAwarded: 2
            }
          }
        ],
        2,
        0
      );

      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        userId: 'user-a',
        oldTotal: 2,
        newTotal: 1,
        pointsDelta: -1,
        scorePts: 0,
        resultPts: 1
      });
    });

    it('should skip unscored and missing predictions', () => {
      const updates = scoring.buildFixtureRescoreUpdates(
        [
          { userId: 'missing', prediction: null },
          {
            userId: 'open',
            prediction: {
              homeScore: 1,
              awayScore: 0,
              resultPick: 'home',
              submittedAt: '2026-06-11T12:00:00.000Z',
              scored: false
            }
          }
        ],
        2,
        0
      );

      expect(updates).toHaveLength(0);
    });

    it('should treat missing pointsAwarded as zero when rescoring', () => {
      const updates = scoring.buildFixtureRescoreUpdates(
        [
          {
            userId: 'legacy',
            prediction: {
              homeScore: 2,
              awayScore: 0,
              resultPick: 'home',
              submittedAt: '2026-06-11T12:00:00.000Z',
              scored: true
            }
          }
        ],
        2,
        0
      );

      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        userId: 'legacy',
        oldTotal: 0,
        newTotal: 3,
        pointsDelta: 3
      });
    });

    it('should skip predictions that already match the new scoring', () => {
      const updates = scoring.buildFixtureRescoreUpdates(
        [
          {
            userId: 'user-b',
            prediction: {
              homeScore: 2,
              awayScore: 0,
              resultPick: 'home',
              submittedAt: '2026-06-11T12:00:00.000Z',
              scored: true,
              scorePoints: 2,
              resultPoints: 1,
              pointsAwarded: 3
            }
          }
        ],
        2,
        0
      );

      expect(updates).toHaveLength(0);
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
    getPredictionsForFixture: jest.fn().mockResolvedValue([]),
    tryAcquireScoringLock: jest.fn().mockResolvedValue(true),
    releaseScoringLock: jest.fn().mockResolvedValue(undefined),
    applyFixtureScoringResults: jest.fn().mockResolvedValue(undefined),
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

  it('should skip already-scored fixture', async () => {
    const fixture = { id: 1, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      getScoredFixtures: jest.fn().mockResolvedValue([1])
    });
    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture])
    });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    const count = await scoreFinished(null);
    expect(count).toBe(0);
    expect(store.applyFixtureScoringResults).not.toHaveBeenCalled();
  });

  it('should skip duplicate finished fixtures in one run', async () => {
    const fixture = { id: 1, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      getPredictionsForFixture: jest.fn().mockResolvedValue([])
    });
    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture, fixture])
    });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    const count = await scoreFinished(null);
    expect(count).toBe(1);
    expect(store.applyFixtureScoringResults).toHaveBeenCalledTimes(1);
  });

  it('should skip fixture when scoring lock is held', async () => {
    const fixture = { id: 1, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      tryAcquireScoringLock: jest.fn().mockResolvedValue(false)
    });
    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture])
    });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    const count = await scoreFinished(null);
    expect(count).toBe(0);
    expect(store.releaseScoringLock).not.toHaveBeenCalled();
  });

  it('should skip missing predictions in the scoring loop', async () => {
    const fixture = { id: 7, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      getPredictionsForFixture: jest.fn().mockResolvedValue([
        { userId: 'user1', prediction: null }
      ])
    });
    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture])
    });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    expect(await scoreFinished(null)).toBe(1);
    expect(store.applyFixtureScoringResults).toHaveBeenCalledWith(7, []);
  });

  it('should skip already-scored predictions in the scoring loop', async () => {
    const fixture = { id: 6, status: 'FT', goals: { home: 1, away: 0 } };
    const store = makeStore({
      getPredictionsForFixture: jest.fn().mockResolvedValue([
        {
          userId: 'user1',
          prediction: {
            homeScore: 1,
            awayScore: 0,
            resultPick: 'home',
            scored: true,
            pointsAwarded: 3
          }
        }
      ])
    });
    const deps = makeDeps({
      getFixtures: jest.fn().mockResolvedValue([fixture])
    });
    const scoreFinished = scoring.createScoreFinishedFixtures(store, deps);
    const count = await scoreFinished(null);
    expect(count).toBe(1);
    expect(store.applyFixtureScoringResults).toHaveBeenCalledWith(6, []);
  });

  it('should score predictors and post announcement when earners exist (line 149)', async () => {
    const fixture = { id: 2, status: 'FT', goals: { home: 2, away: 1 } };
    const store = makeStore({
      getPredictionsForFixture: jest.fn().mockResolvedValue([
        {
          userId: 'user1',
          prediction: {
            homeScore: 2, awayScore: 1, resultPick: 'home', scored: false
          }
        }
      ])
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
      getPredictionsForFixture: jest.fn().mockResolvedValue([
        {
          userId: 'user1',
          prediction: {
            homeScore: 2, awayScore: 1, resultPick: 'home', scored: false
          }
        }
      ])
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
      getPredictionsForFixture: jest.fn().mockResolvedValue([
        {
          userId: 'user1',
          prediction: {
            homeScore: 2, awayScore: 1, resultPick: 'home', scored: false
          }
        }
      ])
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
