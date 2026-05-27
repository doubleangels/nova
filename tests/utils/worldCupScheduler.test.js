const dayjs = require('dayjs');

describe('worldCupScheduler', () => {
  let scheduler;
  let mockUtils;
  let mockClient;

  beforeEach(() => {
    jest.resetModules();

    mockUtils = {
      isWorldCupGameConfigured: jest.fn().mockReturnValue(true),
      getRegisteredUserIds: jest.fn().mockResolvedValue(['111111111111111111']),
      getPromptedFixtures: jest.fn().mockResolvedValue([]),
      markFixturePrompted: jest.fn().mockResolvedValue(),
      buildPromptEmbed: jest.fn().mockReturnValue({ data: { title: 'Prompt' } }),
      isInReminderWindow: jest.fn().mockReturnValue(true),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0)
    };

    jest.doMock('../../utils/worldCupUtils', () => mockUtils);
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
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
      worldCupChannelId: '222222222222222222',
      worldCupPollIntervalMs: 60000
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

  it('should log when DM fails', async () => {
    const debug = jest.fn();
    jest.resetModules();
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      debug
    }));
    jest.doMock('../../utils/worldCupUtils', () => mockUtils);
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
      getSeasonFixtures: jest.fn()
    }));
    jest.doMock('../../config', () => ({ worldCupChannelId: '222222222222222222' }));
    const s = require('../../utils/worldCupScheduler');

    const clientWithDmFail = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => true,
          send: jest.fn().mockResolvedValue({})
        })
      },
      users: {
        fetch: jest.fn().mockResolvedValue({
          send: jest.fn().mockRejectedValue(new Error('dm closed'))
        })
      }
    };

    const fixture = {
      id: 79,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };

    await s.sendPredictionPrompts(clientWithDmFail, fixture);
    expect(debug).toHaveBeenCalled();
  });

  it('should send channel prompt and DM registered users', async () => {
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
    expect(mockUtils.markFixturePrompted).toHaveBeenCalledWith(77);
    expect(mockClient.users.fetch).toHaveBeenCalledWith('111111111111111111');
  });

  it('should no-op poll when API or channel not configured', async () => {
    jest.resetModules();
    const scoreFinishedFixtures = jest.fn();
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(false)
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
    jest.doMock('../../utils/worldCupUtils', () => ({
      isWorldCupGameConfigured: jest.fn().mockReturnValue(true),
      getRegisteredUserIds: jest.fn().mockResolvedValue([]),
      getPromptedFixtures: jest.fn().mockResolvedValue([]),
      markFixturePrompted,
      buildPromptEmbed: jest.fn(),
      isInReminderWindow: jest.fn().mockReturnValue(false),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0)
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
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
      worldCupChannelId: '222222222222222222',
      worldCupPollIntervalMs: 60000
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
      getSeasonFixtures: jest.fn()
    }));
    jest.doMock('../../config', () => ({
      worldCupChannelId: '222222222222222222',
      worldCupPollIntervalMs: 600000
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
    expect(mockUtils.markFixturePrompted).toHaveBeenCalledWith(81);
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
    expect(mockUtils.markFixturePrompted).toHaveBeenCalledWith(80);
  });

  it('should not start scheduler when not configured', () => {
    jest.resetModules();
    jest.doMock('../../utils/worldCupUtils', () => ({
      isWorldCupGameConfigured: jest.fn().mockReturnValue(false)
    }));
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(false)
    }));
    jest.doMock('../../config', () => ({}));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));

    const s = require('../../utils/worldCupScheduler');
    s.startWorldCupScheduler(mockClient);
    expect(mockClient.channels.fetch).not.toHaveBeenCalled();
  });
});
