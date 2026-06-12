const dayjs = require('dayjs');

describe('predictionScheduler', () => {
  let mockStore;
  let mockClient;
  let fetchMatchAiPrediction;
  let getSeasonFixtures;
  let scheduler;
  let createPredictionScheduler;

  beforeEach(() => {
    jest.resetModules();

    mockStore = {
      getPromptedFixtures: jest.fn().mockResolvedValue([]),
      tryClaimFixtureForPrompt: jest.fn().mockResolvedValue(true),
      releaseFixturePromptClaim: jest.fn().mockResolvedValue(undefined),
      markFixturePrompted: jest.fn().mockResolvedValue(undefined),
      isPromptingPaused: jest.fn().mockResolvedValue(false)
    };

    getSeasonFixtures = jest.fn().mockResolvedValue([
      {
        id: 1,
        home: 'A',
        away: 'B',
        kickoff: dayjs().add(6, 'hour').toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      },
      {
        id: 2,
        home: 'C',
        away: 'D',
        kickoff: dayjs().add(8, 'hour').toISOString(),
        status: 'NS',
        goals: { home: null, away: null }
      }
    ]);

    fetchMatchAiPrediction = jest.fn().mockResolvedValue(null);

    jest.doMock('../../utils/matchPredictionAi', () => ({
      fetchMatchAiPrediction: (...args) => fetchMatchAiPrediction(...args)
    }));
    jest.doMock('../../config', () => ({
      predictionPollIntervalMs: 60000
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    }));

    ({ createPredictionScheduler } = require('../../utils/predictionScheduler'));

    scheduler = createPredictionScheduler({
      logLabel: 'Test',
      buttonPrefix: 'test:predict:',
      aiGameId: 'club',
      participantRoleId: 'role-1',
      channelId: 'channel-1',
      isApiConfigured: () => true,
      isGameConfigured: () => true,
      isMockApiEnabled: () => false,
      mockPlayableIds: [],
      getSeasonFixtures,
      store: mockStore,
      buildPromptEmbed: jest.fn().mockReturnValue({ data: { title: 'Prompt' } }),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0),
      resetMockDemoState: jest.fn().mockResolvedValue(undefined),
      isInReminderWindow: jest.fn().mockReturnValue(true)
    });

    mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => true,
          send: jest.fn().mockResolvedValue({})
        })
      }
    };
  });

  it('should prompt multiple fixtures with bounded AI concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    fetchMatchAiPrediction.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 20));
      inFlight -= 1;
      return null;
    });

    await scheduler.runPoll(mockClient);

    expect(fetchMatchAiPrediction).toHaveBeenCalledTimes(2);
    expect(mockStore.tryClaimFixtureForPrompt).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('should skip fixtures already present in prompted set', async () => {
    mockStore.getPromptedFixtures.mockResolvedValue([1]);

    await scheduler.runPoll(mockClient);

    expect(fetchMatchAiPrediction).toHaveBeenCalledTimes(1);
    expect(mockStore.tryClaimFixtureForPrompt).toHaveBeenCalledWith(2);
    expect(mockStore.tryClaimFixtureForPrompt).not.toHaveBeenCalledWith(1);
  });

  it('should skip AI calls when every open fixture was already prompted', async () => {
    mockStore.getPromptedFixtures.mockResolvedValue([1, 2]);

    await scheduler.runPoll(mockClient);

    expect(fetchMatchAiPrediction).not.toHaveBeenCalled();
    expect(mockStore.tryClaimFixtureForPrompt).not.toHaveBeenCalled();
  });

  it('should skip fixtures with invalid ids', async () => {
    const channelSend = jest.fn().mockResolvedValue({});
    mockClient.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      send: channelSend
    });

    await scheduler.sendPredictionPrompts(mockClient, {
      id: 'not-a-number',
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    });

    expect(mockStore.tryClaimFixtureForPrompt).not.toHaveBeenCalled();
    expect(channelSend).not.toHaveBeenCalled();
  });

  it('should not send when prompt claim fails', async () => {
    const channelSend = jest.fn().mockResolvedValue({});
    mockClient.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      send: channelSend
    });
    mockStore.tryClaimFixtureForPrompt.mockResolvedValue(false);

    const fixture = {
      id: 9,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };

    await scheduler.sendPredictionPrompts(mockClient, fixture);
    await scheduler.sendPredictionPrompts(mockClient, fixture);

    expect(channelSend).not.toHaveBeenCalled();
    expect(fetchMatchAiPrediction).not.toHaveBeenCalled();
  });

  it('should release claim when channel send fails', async () => {
    mockClient.channels.fetch.mockRejectedValue(new Error('channel down'));
    const fixture = {
      id: 11,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };

    await scheduler.sendPredictionPrompts(mockClient, fixture);

    expect(mockStore.tryClaimFixtureForPrompt).toHaveBeenCalledWith(11);
    expect(mockStore.releaseFixturePromptClaim).toHaveBeenCalledWith(11);
  });

  it('should reprompt fixture by releasing claim, posting, and marking prompted', async () => {
    const channelSend = jest.fn().mockResolvedValue({});
    mockClient.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      send: channelSend
    });
    const fixture = {
      id: 42,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };

    const posted = await scheduler.repromptFixture(mockClient, fixture);

    expect(posted).toBe(true);
    expect(mockStore.releaseFixturePromptClaim).toHaveBeenCalledWith(42);
    expect(mockStore.tryClaimFixtureForPrompt).not.toHaveBeenCalled();
    expect(channelSend).toHaveBeenCalled();
    expect(mockStore.markFixturePrompted).toHaveBeenCalledWith(42);
  });

  it('should return false from repromptFixture when channel send fails', async () => {
    mockClient.channels.fetch.mockRejectedValue(new Error('channel down'));
    const fixture = {
      id: 43,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };

    const posted = await scheduler.repromptFixture(mockClient, fixture);

    expect(posted).toBe(false);
    expect(mockStore.releaseFixturePromptClaim).toHaveBeenCalledWith(43);
    expect(mockStore.markFixturePrompted).not.toHaveBeenCalled();
  });

  it('should return false from repromptFixture when fixture id is invalid', async () => {
    const posted = await scheduler.repromptFixture(mockClient, { id: 'bad' });
    expect(posted).toBe(false);
    expect(mockStore.releaseFixturePromptClaim).not.toHaveBeenCalled();
  });

  it('should return false from repromptFixture when channel is not text-based', async () => {
    mockClient.channels.fetch.mockResolvedValue({
      isTextBased: () => false,
      send: jest.fn()
    });
    const fixture = {
      id: 44,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };

    const posted = await scheduler.repromptFixture(mockClient, fixture);

    expect(posted).toBe(false);
    expect(mockStore.releaseFixturePromptClaim).toHaveBeenCalledWith(44);
    expect(mockStore.markFixturePrompted).not.toHaveBeenCalled();
  });

  it('should omit role ping content when participant role is unset', async () => {
    const channelSend = jest.fn().mockResolvedValue({});
    mockClient.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      send: channelSend
    });
    const noRoleScheduler = createPredictionScheduler({
      logLabel: 'Test',
      buttonPrefix: 'test:predict:',
      aiGameId: 'club',
      participantRoleId: '',
      channelId: 'channel-1',
      isApiConfigured: () => true,
      isGameConfigured: () => true,
      isMockApiEnabled: () => false,
      mockPlayableIds: [],
      getSeasonFixtures,
      store: mockStore,
      buildPromptEmbed: jest.fn().mockReturnValue({ data: { title: 'Prompt' } }),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0),
      resetMockDemoState: jest.fn().mockResolvedValue(undefined),
      isInReminderWindow: jest.fn().mockReturnValue(true)
    });
    const fixture = {
      id: 45,
      home: 'A',
      away: 'B',
      kickoff: dayjs().add(6, 'hour').toISOString(),
      status: 'NS',
      goals: { home: null, away: null }
    };

    const posted = await noRoleScheduler.repromptFixture(mockClient, fixture);

    expect(posted).toBe(true);
    expect(channelSend).toHaveBeenCalledWith(
      expect.not.objectContaining({ content: expect.any(String) })
    );
  });

  it('should clear stale scoring locks during startup', async () => {
    mockStore.clearStaleScoringLocks = jest.fn().mockReturnValue(2);

    await scheduler.runStartup(mockClient);

    expect(mockStore.clearStaleScoringLocks).toHaveBeenCalled();
    expect(getSeasonFixtures).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it('should skip stale lock logging when startup finds none', async () => {
    mockStore.clearStaleScoringLocks = jest.fn().mockReturnValue(0);

    await scheduler.runStartup(mockClient);

    expect(mockStore.clearStaleScoringLocks).toHaveBeenCalled();
  });

  it('should wait for in-flight polls to finish during drain', async () => {
    let releasePoll;
    const pollGate = new Promise(resolve => {
      releasePoll = resolve;
    });
    getSeasonFixtures.mockImplementation(async () => {
      await pollGate;
      return [];
    });

    const pollPromise = scheduler.runPoll(mockClient);
    await new Promise(resolve => setImmediate(resolve));
    const drainPromise = scheduler.waitForPollDrain(5_000);
    releasePoll();
    await pollPromise;
    await drainPromise;
  });

  it('should clear poll interval while waiting for drain', async () => {
    scheduler.startScheduler(mockClient);
    await scheduler.waitForPollDrain();
  });
});
