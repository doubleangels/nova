describe('footballUtils', () => {
  let utils;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }));
    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      predictionMockApi: true,
      footballChannelId: '999999999999999999',
      footballDataApiKey: 'key',
      predictionPendingTtlMs: 600000
    }));
    utils = require('../../utils/footballUtils');
  });

  it('should return true from isFootballGameConfigured when configured', () => {
    expect(utils.isFootballGameConfigured()).toBe(true);
  });

  it('should batch-fetch user predictions via getPredictionsForUser', async () => {
    await utils.savePrediction('user-1', 7, {
      homeScore: 2,
      awayScore: 1,
      resultPick: 'home',
      submittedAt: new Date().toISOString()
    });

    const rows = await utils.getPredictionsForUser('user-1', [7, 8]);
    expect(rows).toEqual([
      expect.objectContaining({ fixtureId: 7, prediction: expect.objectContaining({ homeScore: 2 }) }),
      { fixtureId: 8, prediction: null }
    ]);
  });

  it('should return false from isFootballGameConfigured when no channel', () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ predictionMockApi: true, footballChannelId: '' }));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    const u = require('../../utils/footballUtils');
    expect(u.isFootballGameConfigured()).toBe(false);
  });

  it('should return false from isFootballGameConfigured when no API key and no mock', () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      predictionMockApi: false,
      footballDataApiKey: '',
      footballChannelId: '123'
    }));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    const u = require('../../utils/footballUtils');
    expect(u.isFootballGameConfigured()).toBe(false);

    // Cover truthy but whitespace-only API key
    jest.resetModules();
    jest.doMock('../../config', () => ({
      predictionMockApi: false,
      footballDataApiKey: '   ',
      footballChannelId: '123'
    }));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    const u2 = require('../../utils/footballUtils');
    expect(u2.isFootballGameConfigured()).toBe(false);

    // Cover valid API key without mock
    jest.resetModules();
    jest.doMock('../../config', () => ({
      predictionMockApi: false,
      footballDataApiKey: 'real-key',
      footballChannelId: '123'
    }));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    const u3 = require('../../utils/footballUtils');
    expect(u3.isFootballGameConfigured()).toBe(true);
  });

  it('should register and check user registration', async () => {
    await utils.addRegisteredUser('user-fu-1');
    expect(await utils.isUserRegistered('user-fu-1')).toBe(true);
    expect(await utils.isUserRegistered('user-fu-unknown')).toBe(false);
    const users = await utils.getRegisteredUserIds();
    expect(users).toContain('user-fu-1');
  });

  it('should save and retrieve a prediction', async () => {
    await utils.savePrediction('user-fu-2', 101, {
      homeScore: 2, awayScore: 1, resultPick: 'home',
      submittedAt: new Date().toISOString()
    });
    const pred = await utils.getPrediction('user-fu-2', 101);
    expect(pred.homeScore).toBe(2);
    expect(await utils.getUserPredictionFixtureIds('user-fu-2')).toContain(101);
  });

  it('should track and retrieve points', async () => {
    await utils.addUserPoints('user-fu-3', 5);
    expect(await utils.getUserPoints('user-fu-3')).toBe(5);
  });

  it('should save, get, and clear pending predictions', async () => {
    await utils.savePendingPrediction('user-fu-4', 202, { homeScore: 1 });
    const p = await utils.getPendingPrediction('user-fu-4', 202);
    expect(p?.homeScore).toBe(1);
    await utils.clearPendingPrediction('user-fu-4', 202);
    expect(await utils.getPendingPrediction('user-fu-4', 202)).toBeNull();
  });

  it('should mark and retrieve prompted and scored fixtures', async () => {
    await utils.markFixturePrompted(301);
    expect(await utils.getPromptedFixtures()).toContain(301);
    await utils.markFixtureScored(302);
    expect(await utils.getScoredFixtures()).toContain(302);
  });

  it('should track predictor ids for a fixture', async () => {
    await utils.savePrediction('user-fu-5', 401, {
      homeScore: 0, awayScore: 0, resultPick: 'draw',
      submittedAt: new Date().toISOString()
    });
    expect(await utils.getPredictorIdsForFixture(401)).toContain('user-fu-5');
  });

  it('should set and read prompting paused state', async () => {
    await utils.setPromptingPaused(true);
    expect(await utils.isPromptingPaused()).toBe(true);
    await utils.setPromptingPaused(false);
    expect(await utils.isPromptingPaused()).toBe(false);
  });

  it('should reset the football game', async () => {
    await utils.addRegisteredUser('user-fu-6');
    await utils.resetFootballGame();
    expect(await utils.isUserRegistered('user-fu-6')).toBe(false);
  });

  it('should call resetMockDemoState without error', async () => {
    await expect(utils.resetMockDemoState()).resolves.not.toThrow();
  });

  it('should return result from areAllMockPlayableFixturesPredicted', async () => {
    const result = await utils.areAllMockPlayableFixturesPredicted();
    expect(typeof result).toBe('boolean');
  });

  it('should build a prompt embed', () => {
    const fixture = {
      id: 1, home: 'Arsenal', away: 'Chelsea',
      kickoff: '2026-06-01T12:00:00Z', status: 'NS',
      goals: { home: null, away: null }, competitionCode: 'PL'
    };
    const embed = utils.buildPromptEmbed(fixture);
    expect(embed.data.title).toContain('Match Open');
  });

  it('should build a prompt embed with competition label', () => {
    const fixture = {
      id: 2, home: 'Arsenal', away: 'Chelsea',
      kickoff: '2026-06-01T12:00:00Z', status: 'NS',
      goals: { home: null, away: null },
      competitionName: 'Premier League', competitionCode: 'PL'
    };
    const embed = utils.buildPromptEmbed(fixture);
    expect(embed.data.title).toContain('Premier League');
  });

  it('should build an announcement embed', () => {
    const fixture = {
      id: 3, home: 'Arsenal', away: 'Chelsea',
      kickoff: '2026-06-01T12:00:00Z', status: 'FT',
      goals: { home: 2, away: 1 }
    };
    const embed = utils.buildAnnouncementEmbed(fixture, []);
    expect(embed.data.title).toContain('Arsenal');
  });

  it('should format a fixture line', () => {
    const fixture = {
      id: 4, home: 'Arsenal', away: 'Chelsea',
      kickoff: '2026-06-01T12:00:00Z', status: 'NS',
      goals: { home: null, away: null }, competitionCode: 'PL'
    };
    const line = utils.formatFixtureLine(fixture);
    expect(line).toContain('Arsenal');
  });

  it('should format result pick display', () => {
    const fixture = { home: 'Arsenal', away: 'Chelsea' };
    expect(utils.formatResultPickDisplay(fixture, 'draw')).toBe('Draw');
    expect(utils.formatResultPickDisplay(fixture, 'home')).toContain('Arsenal');
  });

  it('should format result pick options string', () => {
    const fixture = { home: 'Arsenal', away: 'Chelsea' };
    const opts = utils.formatResultPickOptions(fixture);
    expect(typeof opts).toBe('string');
    expect(opts).toContain('draw');
  });

  it('should parse result pick from raw string', () => {
    expect(utils.parseResultPick('home')).toBe('home');
    expect(utils.parseResultPick('draw')).toBe('draw');
    expect(utils.parseResultPick('away')).toBe('away');
    expect(utils.parseResultPick('invalid')).toBeNull();
  });

  it('should parse score inputs', () => {
    expect(utils.parseScoreInputs('2', '1')).toEqual({ homeScore: 2, awayScore: 1 });
    expect(utils.parseScoreInputs('x', '1').error).toBeDefined();
  });

  it('should return leaderboard', async () => {
    await utils.addRegisteredUser('user-fu-7');
    await utils.addUserPoints('user-fu-7', 3);
    const board = await utils.getLeaderboard(5);
    expect(Array.isArray(board)).toBe(true);
  });

  it('should list all predictor user ids', async () => {
    await utils.savePrediction('user-fu-8', 55, {
      homeScore: 2,
      awayScore: 1,
      resultPick: 'home',
      submittedAt: new Date().toISOString()
    });
    const userIds = await utils.getAllPredictorUserIds();
    expect(userIds).toContain('user-fu-8');
  });

  it('should call applyMockInstantFinishToFixtures', async () => {
    const fixtures = [
      { id: 1, status: 'NS', goals: { home: null, away: null } }
    ];
    const result = await utils.applyMockInstantFinishToFixtures(fixtures);
    expect(Array.isArray(result)).toBe(true);
  });

  it('should format discord timestamp', () => {
    const ts = utils.formatDiscordTimestamp('2026-06-01T12:00:00Z');
    expect(typeof ts).toBe('string');
  });

  it('should check isPendingPredictionComplete', () => {
    expect(utils.isPendingPredictionComplete({ homeScore: 1, awayScore: 0, resultPick: 'home' })).toBe(true);
    expect(utils.isPendingPredictionComplete({ homeScore: 1 })).toBe(false);
  });

  it('should goalsModalLabel truncate long names', () => {
    const label = utils.goalsModalLabel('A'.repeat(50));
    expect(label.length).toBeLessThanOrEqual(45);
  });

  it('should truncateModalLabel at max length', () => {
    const label = utils.truncateModalLabel('A'.repeat(50), 20);
    expect(label.length).toBeLessThanOrEqual(20);
  });

  it('should expose PENDING_PREDICTION_TTL_MS', () => {
    expect(typeof utils.PENDING_PREDICTION_TTL_MS).toBe('number');
  });
});
