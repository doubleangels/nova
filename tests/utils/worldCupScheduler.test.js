const dayjs = require('dayjs');

describe('worldCupScheduler', () => {
  let scheduler;
  let mockUtils;
  let mockClient;

  beforeEach(() => {
    jest.resetModules();

    const markFixturePrompted = jest.fn().mockResolvedValue();
    const getPromptedFixtures = jest.fn().mockResolvedValue([]);
    const isPromptingPaused = jest.fn().mockResolvedValue(false);

    mockUtils = {
      isWorldCupGameConfigured: jest.fn().mockReturnValue(true),
      getPromptedFixtures,
      markFixturePrompted,
      buildPromptEmbed: jest.fn().mockReturnValue({ data: { title: 'Prompt' } }),
      isInReminderWindow: jest.fn().mockReturnValue(true),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0),
      resetMockDemoState: jest.fn().mockResolvedValue(),
      store: {
        getPromptedFixtures,
        markFixturePrompted,
        isPromptingPaused
      }
    };

    jest.doMock('../../utils/matchPredictionAi', () => ({
      fetchMatchAiPrediction: jest.fn().mockResolvedValue(null)
    }));
    jest.doMock('../../utils/worldCupUtils', () => mockUtils);
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
      isMockApiEnabled: jest.fn().mockReturnValue(false),
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 77,
          home: 'A',
          away: 'B',
          kickoff: dayjs().add(6, 'hour').toISOString(),
          status: 'NS',
          goals: { home: null, away: null }
        }
      ])
    }));
    jest.doMock('../../config', () => ({
      predictionChannelId: '222222222222222222',
      predictionParticipantRoleId: '333333333333333333',
      predictionPollIntervalMs: 60000
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    }));

    scheduler = require('../../utils/worldCupScheduler');
    scheduler.stopWorldCupScheduler();

    mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => true,
          send: jest.fn().mockResolvedValue({})
        })
      },
      users: {
        fetch: jest.fn().mockResolvedValue({
          send: jest.fn().mockResolvedValue({})
        })
      }
    };
  });

  afterEach(() => {
    scheduler.stopWorldCupScheduler();
  });

  it('should send channel prompt without DMing users', async () => {
    const channelSend = jest.fn().mockResolvedValue({});
    mockClient.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      send: channelSend
    });

    const fixture = {
      id: 77,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };

    await scheduler.sendPredictionPrompts(mockClient, fixture);

    expect(mockClient.channels.fetch).toHaveBeenCalledWith('222222222222222222');
    expect(channelSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          '<@&333333333333333333> A new match is open for predictions - submit yours before kickoff.',
        embeds: expect.any(Array),
        components: expect.any(Array)
      })
    );
    expect(mockUtils.markFixturePrompted).toHaveBeenCalledWith(77);
    expect(mockClient.users.fetch).not.toHaveBeenCalled();
  });

  it('should omit role ping when participant role is not configured', async () => {
    jest.resetModules();
    const markFixturePrompted = jest.fn().mockResolvedValue();
    jest.doMock('../../utils/matchPredictionAi', () => ({
      fetchMatchAiPrediction: jest.fn().mockResolvedValue(null)
    }));
    jest.doMock('../../utils/worldCupUtils', () => ({
      ...mockUtils,
      markFixturePrompted,
      store: {
        markFixturePrompted,
        getPromptedFixtures: jest.fn().mockResolvedValue([]),
        isPromptingPaused: jest.fn().mockResolvedValue(false)
      }
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
      isMockApiEnabled: jest.fn().mockReturnValue(false),
      getSeasonFixtures: jest.fn()
    }));
    jest.doMock('../../config', () => ({
      predictionChannelId: '222222222222222222',
      predictionPollIntervalMs: 60000
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }));
    const s = require('../../utils/worldCupScheduler');

    const channelSend = jest.fn().mockResolvedValue({});
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => true,
          send: channelSend
        })
      },
    };

    await s.sendPredictionPrompts(client, {
      id: 82,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    });

    expect(channelSend).toHaveBeenCalledWith(
      expect.not.objectContaining({ content: expect.any(String) })
    );
  });

  it('should no-op poll when API or channel not configured', async () => {
    jest.resetModules();
    const scoreFinishedFixtures = jest.fn();
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(false),
      isMockApiEnabled: jest.fn().mockReturnValue(false)
    }));
    jest.doMock('../../utils/worldCupUtils', () => ({
      isWorldCupGameConfigured: jest.fn().mockReturnValue(false),
      scoreFinishedFixtures
    }));
    jest.doMock('../../config', () => ({}));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    const s = require('../../utils/worldCupScheduler');
    await s.runWorldCupPoll(mockClient);
    expect(scoreFinishedFixtures).not.toHaveBeenCalled();
  });

  it('should run poll and prompt fixtures in reminder window', async () => {
    await scheduler.runWorldCupPoll(mockClient);

    expect(mockUtils.scoreFinishedFixtures).toHaveBeenCalledWith(mockClient);
    expect(mockUtils.markFixturePrompted).toHaveBeenCalledWith(77);
  });

  it('should skip fixtures outside reminder window', async () => {
    jest.resetModules();
    const markFixturePrompted = jest.fn().mockResolvedValue();
    const getPromptedFixtures = jest.fn().mockResolvedValue([]);
    jest.doMock('../../utils/matchPredictionAi', () => ({
      fetchMatchAiPrediction: jest.fn().mockResolvedValue(null)
    }));
    jest.doMock('../../utils/worldCupUtils', () => ({
      isWorldCupGameConfigured: jest.fn().mockReturnValue(true),
      getRegisteredUserIds: jest.fn().mockResolvedValue([]),
      getPromptedFixtures,
      markFixturePrompted,
      buildPromptEmbed: jest.fn(),
      isInReminderWindow: jest.fn().mockReturnValue(false),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0),
      store: {
        getPromptedFixtures,
        markFixturePrompted,
        isPromptingPaused: jest.fn().mockResolvedValue(false)
      }
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
      isMockApiEnabled: jest.fn().mockReturnValue(false),
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 78,
          home: 'A',
          away: 'B',
          kickoff: dayjs().add(48, 'hour').toISOString(),
          status: 'NS',
          goals: { home: null, away: null }
        }
      ])
    }));
    jest.doMock('../../config', () => ({
      predictionChannelId: '222222222222222222',
      predictionPollIntervalMs: 60000
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }));
    const localScheduler = require('../../utils/worldCupScheduler');
    await localScheduler.runWorldCupPoll(mockClient);
    expect(markFixturePrompted).not.toHaveBeenCalled();
  });

  it('should skip fixtures already prompted', async () => {
    mockUtils.getPromptedFixtures.mockResolvedValue([77]);
    await scheduler.runWorldCupPoll(mockClient);
    expect(mockUtils.markFixturePrompted).not.toHaveBeenCalled();
  });

  it('should reset mock demo state on startup when mock API is enabled', async () => {
    jest.resetModules();
    const resetMockDemoState = jest.fn().mockResolvedValue();
    const scoreFinishedFixtures = jest.fn().mockResolvedValue(0);
    const getPromptedFixtures = jest.fn().mockResolvedValue([]);
    const markFixturePrompted = jest.fn().mockResolvedValue();
    jest.doMock('../../utils/matchPredictionAi', () => ({
      fetchMatchAiPrediction: jest.fn().mockResolvedValue(null)
    }));
    jest.doMock('../../utils/worldCupUtils', () => ({
      isWorldCupGameConfigured: jest.fn().mockReturnValue(true),
      getPromptedFixtures,
      markFixturePrompted,
      buildPromptEmbed: jest.fn(),
      isInReminderWindow: jest.fn().mockReturnValue(true),
      scoreFinishedFixtures,
      resetMockDemoState,
      store: {
        getPromptedFixtures,
        markFixturePrompted,
        isPromptingPaused: jest.fn().mockResolvedValue(false)
      }
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
      isMockApiEnabled: jest.fn().mockReturnValue(true),
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 900001,
          home: 'A',
          away: 'B',
          kickoff: dayjs().add(2, 'hour').toISOString(),
          status: 'NS',
          goals: { home: null, away: null }
        }
      ])
    }));
    jest.doMock('../../config', () => ({
      predictionChannelId: '222222222222222222',
      predictionPollIntervalMs: 60000
    }));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    const s = require('../../utils/worldCupScheduler');

    await s.runWorldCupStartup(mockClient);

    expect(resetMockDemoState).toHaveBeenCalled();
    expect(scoreFinishedFixtures).toHaveBeenCalled();
  });

  it('should restart scheduler and clear prior interval', () => {
    scheduler.startWorldCupScheduler(mockClient);
    scheduler.startWorldCupScheduler(mockClient);
    scheduler.stopWorldCupScheduler();
  });

  it('should start interval scheduler and run poll on tick', async () => {
    jest.useFakeTimers();
    scheduler.startWorldCupScheduler(mockClient);
    await Promise.resolve();
    jest.advanceTimersByTime(60000);
    await Promise.resolve();
    jest.useRealTimers();
    scheduler.stopWorldCupScheduler();
  });

  it('should handle initial poll failure', async () => {
    jest.resetModules();
    mockUtils.scoreFinishedFixtures.mockRejectedValue(new Error('poll fail'));
    jest.doMock('../../utils/worldCupUtils', () => mockUtils);
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
      isMockApiEnabled: jest.fn().mockReturnValue(false),
      getSeasonFixtures: jest.fn()
    }));
    jest.doMock('../../config', () => ({
      predictionChannelId: '222222222222222222',
      predictionPollIntervalMs: 600000
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }));
    const s = require('../../utils/worldCupScheduler');
    await s.runWorldCupPoll(mockClient);
    expect(mockUtils.scoreFinishedFixtures).toHaveBeenCalled();
  });

  it('should skip channel send when channel is missing', async () => {
    mockClient.channels.fetch.mockResolvedValue(null);
    const fixture = {
      id: 81,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };
    await scheduler.sendPredictionPrompts(mockClient, fixture);
    expect(mockUtils.markFixturePrompted).not.toHaveBeenCalled();
  });

  it('should log channel errors when sending prompt', async () => {
    mockClient.channels.fetch.mockRejectedValue(new Error('no channel'));
    const fixture = {
      id: 80,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };
    await scheduler.sendPredictionPrompts(mockClient, fixture);
    expect(mockUtils.markFixturePrompted).not.toHaveBeenCalled();
  });

  it('should not start scheduler when not configured', () => {
    jest.resetModules();
    jest.doMock('../../utils/worldCupUtils', () => ({
      isWorldCupGameConfigured: jest.fn().mockReturnValue(false)
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(false),
      isMockApiEnabled: jest.fn().mockReturnValue(false)
    }));
    jest.doMock('../../config', () => ({}));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));

    const s = require('../../utils/worldCupScheduler');
    s.startWorldCupScheduler(mockClient);
    expect(mockClient.channels.fetch).not.toHaveBeenCalled();
  });
});
