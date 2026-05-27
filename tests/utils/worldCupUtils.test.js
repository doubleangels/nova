const dayjs = require('dayjs');

describe('worldCupUtils', () => {
  let utils;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();
    mockLogger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupReminderHours: 24,
      worldCupChannelId: '999999999999999999'
    }));
    utils = require('../../utils/worldCupUtils');
  });

  it('should log Keyv connection errors', () => {
    utils.worldCupKeyv.emit('error', new Error('keyv fail'));
    expect(mockLogger.error).toHaveBeenCalledWith(
      'World Cup Keyv connection error.',
      expect.objectContaining({ err: expect.any(Error) })
    );
  });

  describe('scoring', () => {
    it('should return 3 for exact score', () => {
      expect(utils.calculateScorePoints(2, 1, 2, 1)).toBe(3);
    });

    it('should return 1 for correct outcome only on score prediction', () => {
      expect(utils.calculateScorePoints(2, 0, 3, 1)).toBe(1);
      expect(utils.calculateScorePoints(1, 1, 0, 0)).toBe(1);
    });

    it('should return 0 for wrong score prediction', () => {
      expect(utils.calculateScorePoints(2, 0, 0, 2)).toBe(0);
    });

    it('should return 1 for correct result pick', () => {
      expect(utils.calculateResultPoints('home', 2, 1)).toBe(1);
      expect(utils.calculateResultPoints('draw', 1, 1)).toBe(1);
      expect(utils.calculateResultPoints('away', 0, 3)).toBe(1);
    });

    it('should return 0 for wrong result pick', () => {
      expect(utils.calculateResultPoints('home', 1, 2)).toBe(0);
    });

    it('should derive outcomes correctly', () => {
      expect(utils.getOutcome(2, 1)).toBe('home');
      expect(utils.getOutcome(1, 1)).toBe('draw');
      expect(utils.getOutcome(0, 2)).toBe('away');
      expect(utils.getOutcome(null, 1)).toBeNull();
    });
  });

  describe('parseResultPick', () => {
    it('should parse valid picks', () => {
      expect(utils.parseResultPick('home')).toBe('home');
      expect(utils.parseResultPick('DRAW')).toBe('draw');
      expect(utils.parseResultPick('away')).toBe('away');
      expect(utils.parseResultPick('a')).toBe('away');
      expect(utils.parseResultPick('h')).toBe('home');
      expect(utils.parseResultPick('d')).toBe('draw');
    });

    it('should return null for invalid picks', () => {
      expect(utils.parseResultPick('win')).toBeNull();
      expect(utils.parseResultPick('')).toBeNull();
      expect(utils.parseResultPick(null)).toBeNull();
    });
  });

  describe('parseScoreInputs', () => {
    it('should parse valid scores', () => {
      expect(utils.parseScoreInputs('2', '1')).toEqual({ homeScore: 2, awayScore: 1 });
    });

    it('should reject invalid scores', () => {
      expect(utils.parseScoreInputs('x', '1').error).toBeDefined();
      expect(utils.parseScoreInputs('16', '0').error).toBeDefined();
      expect(utils.parseScoreInputs('1', '16').error).toContain('Away score');
    });
  });

  describe('isWorldCupGameConfigured', () => {
    it('should return true when configured', () => {
      jest.resetModules();
      jest.doMock('../../config', () => ({
        footballDataApiKey: 'key',
        worldCupChannelId: '123'
      }));
      jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
      const u = require('../../utils/worldCupUtils');
      expect(u.isWorldCupGameConfigured()).toBe(true);
    });

    it('should return false when keys are blank', () => {
      jest.resetModules();
      jest.doMock('../../config', () => ({
        footballDataApiKey: '   ',
        worldCupChannelId: '   '
      }));
      jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
      const u = require('../../utils/worldCupUtils');
      expect(u.isWorldCupGameConfigured()).toBe(false);
    });

    it('should return true when mock API is enabled', () => {
      jest.resetModules();
      jest.doMock('../../config', () => ({
        worldCupMockApi: true,
        footballDataApiKey: '',
        worldCupChannelId: '123'
      }));
      jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
      const u = require('../../utils/worldCupUtils');
      expect(u.isWorldCupGameConfigured()).toBe(true);
    });
  });

  describe('isFixtureOpenForPrediction', () => {
    it('should reject null fixture', () => {
      expect(utils.isFixtureOpenForPrediction(null)).toBe(false);
    });

    it('should allow fixtures without kickoff time', () => {
      expect(utils.isFixtureOpenForPrediction({
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: '',
        status: 'NS',
        goals: { home: null, away: null }
      })).toBe(true);
    });

    it('should allow NS fixtures before kickoff', () => {
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: dayjs().add(2, 'hour').toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      };
      expect(utils.isFixtureOpenForPrediction(fixture)).toBe(true);
    });

    it('should reject started fixtures', () => {
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: dayjs().subtract(1, 'hour').toISOString(),
        status: '1H',
        goals: { home: 0, away: 0 }
      };
      expect(utils.isFixtureOpenForPrediction(fixture)).toBe(false);
    });
  });

  describe('isInReminderWindow', () => {
    it('should be true within reminder hours before kickoff', () => {
      const kickoff = dayjs().add(12, 'hour');
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: kickoff.toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      };
      expect(utils.isInReminderWindow(fixture, new Date(), 24)).toBe(true);
    });

    it('should use default now and reminder hours from config', () => {
      const kickoff = dayjs().add(12, 'hour');
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: kickoff.toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      };
      expect(utils.isInReminderWindow(fixture)).toBe(true);
    });

    it('should be true exactly at reminder window start', () => {
      const kickoff = dayjs().add(12, 'hour');
      const start = kickoff.subtract(24, 'hour');
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: kickoff.toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      };
      expect(utils.isInReminderWindow(fixture, start.toDate(), 24)).toBe(true);
    });

    it('should be false after kickoff', () => {
      const kickoff = dayjs().subtract(1, 'hour');
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: kickoff.toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      };
      expect(utils.isInReminderWindow(fixture, new Date(), 24)).toBe(false);
    });

    it('should be false without kickoff', () => {
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: '',
        status: 'NS',
        goals: { home: null, away: null }
      };
      expect(utils.isInReminderWindow(fixture, new Date(), 24)).toBe(false);
    });

    it('should be false outside reminder window', () => {
      const kickoff = dayjs().add(48, 'hour');
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: kickoff.toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      };
      expect(utils.isInReminderWindow(fixture, new Date(), 24)).toBe(false);
    });

    it('should be false for non-open fixture status', () => {
      const kickoff = dayjs().add(12, 'hour');
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: kickoff.toISOString(),
        status: 'FT',
        goals: { home: 1, away: 0 }
      };
      expect(utils.isInReminderWindow(fixture, new Date(), 24)).toBe(false);
    });

    it('should be false exactly at kickoff', () => {
      const kickoff = dayjs().add(1, 'minute');
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: kickoff.toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      };
      expect(utils.isInReminderWindow(fixture, kickoff.toDate(), 24)).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should ignore duplicate registration', async () => {
      await utils.addRegisteredUser('101010101010101010');
      await utils.addRegisteredUser('101010101010101010');
      const list = await utils.getRegisteredUserIds();
      expect(list.filter(id => id === '101010101010101010')).toHaveLength(1);
    });

    it('should ignore duplicate prompted and scored markers', async () => {
      await utils.markFixturePrompted(1001);
      await utils.markFixturePrompted(1001);
      await utils.markFixtureScored(2002);
      await utils.markFixtureScored(2002);
      expect((await utils.getPromptedFixtures()).filter(id => id === 1001)).toHaveLength(1);
      expect((await utils.getScoredFixtures()).filter(id => id === 2002)).toHaveLength(1);
    });

    it('should return empty user prediction list for unknown user', async () => {
      expect(await utils.getUserPredictionFixtureIds('000000000000000001')).toEqual([]);
    });

    it('should not duplicate fixture index entries on save', async () => {
      await utils.savePrediction('131313131313131313', 44, {
        homeScore: 1,
        awayScore: 0,
        resultPick: 'home',
        submittedAt: new Date().toISOString()
      });
      await utils.savePrediction('131313131313131313', 44, {
        homeScore: 2,
        awayScore: 1,
        resultPick: 'home',
        submittedAt: new Date().toISOString()
      });
      const ids = await utils.getPredictorIdsForFixture(44);
      expect(ids.filter(id => id === '131313131313131313')).toHaveLength(1);
    });

    it('should register user and save prediction', async () => {
      await utils.addRegisteredUser('111111111111111111');
      expect(await utils.isUserRegistered('111111111111111111')).toBe(true);

      await utils.savePrediction('111111111111111111', 42, {
        homeScore: 2,
        awayScore: 1,
        resultPick: 'home',
        submittedAt: new Date().toISOString()
      });

      const pred = await utils.getPrediction('111111111111111111', 42);
      expect(pred.homeScore).toBe(2);
      expect(await utils.getUserPredictionFixtureIds('111111111111111111')).toContain(42);
    });

    it('should build announcement embed', () => {
      const fixture = {
        id: 1,
        home: 'Brazil',
        away: 'Argentina',
        kickoff: '2026-06-12T18:00:00+00:00',
        status: 'FT',
        goals: { home: 2, away: 1 }
      };
      const embed = utils.buildAnnouncementEmbed(fixture, [
        { userId: '111111111111111111', scorePoints: 3, resultPoints: 1, total: 4 }
      ]);
      expect(embed.data.title).toContain('Brazil');
      expect(embed.data.fields[0].value).toContain('<@111111111111111111>');
    });

    it('should format fixture without kickoff as TBD', () => {
      const line = utils.formatFixtureLine({
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: '',
        status: 'TBD',
        goals: { home: null, away: null }
      });
      expect(line).toContain('TBD');
    });

    it('should format fixture kickoff as Discord timestamp', () => {
      const line = utils.formatFixtureLine({
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: '2026-06-01T12:00:00Z',
        status: 'NS',
        goals: { home: null, away: null }
      });
      expect(line).toContain('<t:1780315200:f>');
      expect(line).not.toContain('UTC');
    });

    it('should build prompt embed', () => {
      const embed = utils.buildPromptEmbed({
        id: 3,
        home: 'A',
        away: 'B',
        kickoff: '2026-06-12T18:00:00+00:00',
        status: 'NS',
        goals: { home: null, away: null }
      });
      expect(embed.data.title).toBe('World Cup prediction');
    });

    it('should use question marks when goals are null in announcement', () => {
      const embed = utils.buildAnnouncementEmbed({
        id: 4,
        home: 'A',
        away: 'B',
        kickoff: '2026-06-12T18:00:00+00:00',
        status: 'FT',
        goals: { home: null, away: null }
      }, []);
      expect(embed.data.title).toContain('?');
    });

    it('should sort multiple earners in announcement', () => {
      const fixture = {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: '2026-06-12T18:00:00+00:00',
        status: 'FT',
        goals: { home: 1, away: 0 }
      };
      const embed = utils.buildAnnouncementEmbed(fixture, [
        { userId: '1', scorePoints: 1, resultPoints: 0, total: 1 },
        { userId: '2', scorePoints: 3, resultPoints: 1, total: 4 }
      ]);
      expect(embed.data.fields[0].value.indexOf('<@2>')).toBeLessThan(
        embed.data.fields[0].value.indexOf('<@1>')
      );
    });

    it('should build announcement with no earners', () => {
      const fixture = {
        id: 2,
        home: 'A',
        away: 'B',
        kickoff: '2026-06-12T18:00:00+00:00',
        status: 'FT',
        goals: { home: 0, away: 0 }
      };
      const embed = utils.buildAnnouncementEmbed(fixture, []);
      expect(embed.data.fields[0].value).toContain('No registered predictions');
    });

    it('should expose predictor ids for a fixture', async () => {
      await utils.savePrediction('121212121212121212', 33, {
        homeScore: 1,
        awayScore: 0,
        resultPick: 'home',
        submittedAt: new Date().toISOString()
      });
      const ids = await utils.getPredictorIdsForFixture(33);
      expect(ids).toContain('121212121212121212');
    });

    it('should track points and leaderboard', async () => {
      await utils.addUserPoints('222222222222222222', 3);
      await utils.addRegisteredUser('222222222222222222');
      const board = await utils.getLeaderboard(5);
      expect(board.some(e => e.userId === '222222222222222222')).toBe(true);
      const defaultBoard = await utils.getLeaderboard();
      expect(defaultBoard.length).toBeLessThanOrEqual(10);
    });

    it('should mark prompted and scored fixtures', async () => {
      await utils.markFixturePrompted(99);
      expect(await utils.getPromptedFixtures()).toContain(99);
      await utils.markFixtureScored(88);
      expect(await utils.getScoredFixtures()).toContain(88);
    });
  });
});

describe('worldCupUtils scoreFinishedFixtures', () => {
  it('should skip unscored predictions that are missing or already scored', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupChannelId: '888888888888888888',
      footballDataApiKey: 'key'
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 901,
          home: 'A',
          away: 'B',
          kickoff: '2026-06-01T12:00:00+00:00',
          status: 'FT',
          goals: { home: 0, away: 0 }
        }
      ])
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }));

    const scoringUtils = require('../../utils/worldCupUtils');
    await scoringUtils.savePrediction('666666666666666666', 901, {
      homeScore: 0,
      awayScore: 0,
      resultPick: 'draw',
      submittedAt: new Date().toISOString(),
      scored: true
    });
    await scoringUtils.worldCupKeyv.set('predictions_by_fixture:901', [
      '666666666666666666',
      '777777777777777777'
    ]);

    const count = await scoringUtils.scoreFinishedFixtures(null);
    expect(count).toBe(1);
  });

  it('should score predictions with zero points', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupChannelId: '888888888888888888',
      footballDataApiKey: 'key'
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 950,
          home: 'A',
          away: 'B',
          kickoff: '2026-06-01T12:00:00+00:00',
          status: 'FT',
          goals: { home: 3, away: 0 }
        }
      ])
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }));

    const scoringUtils = require('../../utils/worldCupUtils');
    await scoringUtils.savePrediction('888888888888888888', 950, {
      homeScore: 0,
      awayScore: 2,
      resultPick: 'away',
      submittedAt: new Date().toISOString(),
      scored: false
    });

    const count = await scoringUtils.scoreFinishedFixtures(null);
    expect(count).toBe(1);
    const pred = await scoringUtils.getPrediction('888888888888888888', 950);
    expect(pred.pointsAwarded).toBe(0);
    expect(await scoringUtils.getUserPoints('888888888888888888')).toBe(0);
  });

  it('should score finished fixtures and post announcement', async () => {
    jest.resetModules();
    const send = jest.fn().mockResolvedValue({});
    const mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => true,
          send
        })
      }
    };

    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupChannelId: '888888888888888888',
      footballDataApiKey: 'key'
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 500,
          home: 'X',
          away: 'Y',
          kickoff: '2026-06-01T12:00:00+00:00',
          status: 'FT',
          goals: { home: 1, away: 0 }
        }
      ])
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }));

    const scoringUtils = require('../../utils/worldCupUtils');
    await scoringUtils.savePrediction('333333333333333333', 500, {
      homeScore: 1,
      awayScore: 0,
      resultPick: 'home',
      submittedAt: new Date().toISOString(),
      scored: false
    });

    const count = await scoringUtils.scoreFinishedFixtures(mockClient);
    expect(count).toBe(1);
    expect(send).toHaveBeenCalled();

    const pred = await scoringUtils.getPrediction('333333333333333333', 500);
    expect(pred.scored).toBe(true);
    expect(pred.pointsAwarded).toBeGreaterThan(0);

    const second = await scoringUtils.scoreFinishedFixtures(mockClient);
    expect(second).toBe(0);
  });

  it('should skip fixtures already in scored list', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupChannelId: '888888888888888888',
      footballDataApiKey: 'key'
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 601,
          home: 'A',
          away: 'B',
          kickoff: '2026-06-01T12:00:00+00:00',
          status: 'FT',
          goals: { home: 0, away: 0 }
        }
      ])
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }));

    const scoringUtils = require('../../utils/worldCupUtils');
    await scoringUtils.markFixtureScored(601);
    const count = await scoringUtils.scoreFinishedFixtures(null);
    expect(count).toBe(0);
  });

  it('should log when announcement channel fetch fails', async () => {
    jest.resetModules();
    const mockLog = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const mockClient = {
      channels: {
        fetch: jest.fn().mockRejectedValue(new Error('channel fail'))
      }
    };

    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupChannelId: '888888888888888888',
      footballDataApiKey: 'key'
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 701,
          home: 'A',
          away: 'B',
          kickoff: '2026-06-01T12:00:00+00:00',
          status: 'FT',
          goals: { home: 1, away: 0 }
        }
      ])
    }));
    jest.doMock('../../logger', () => () => mockLog);

    const scoringUtils = require('../../utils/worldCupUtils');
    const count = await scoringUtils.scoreFinishedFixtures(mockClient);
    expect(count).toBe(1);
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('should skip send when channel is not text-based', async () => {
    jest.resetModules();
    const send = jest.fn();
    const mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue({ isTextBased: () => false, send })
      }
    };

    jest.doMock('../../config', () => ({
      baseEmbedColor: 0xABCDEF,
      worldCupChannelId: '888888888888888888',
      footballDataApiKey: 'key'
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 801,
          home: 'A',
          away: 'B',
          kickoff: '2026-06-01T12:00:00+00:00',
          status: 'FT',
          goals: { home: 0, away: 0 }
        }
      ])
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }));

    const scoringUtils = require('../../utils/worldCupUtils');
    const count = await scoringUtils.scoreFinishedFixtures(mockClient);
    expect(count).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('should return 0 when world cup not configured', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      worldCupChannelId: '',
      footballDataApiKey: ''
    }));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    const scoringUtils = require('../../utils/worldCupUtils');
    expect(await scoringUtils.scoreFinishedFixtures(null)).toBe(0);
  });
});
