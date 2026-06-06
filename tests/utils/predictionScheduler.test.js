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
    expect(mockStore.markFixturePrompted).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('should skip fixtures already present in prompted set', async () => {
    mockStore.getPromptedFixtures.mockResolvedValue([1]);

    await scheduler.runPoll(mockClient);

    expect(fetchMatchAiPrediction).toHaveBeenCalledTimes(1);
    expect(mockStore.markFixturePrompted).toHaveBeenCalledWith(2);
    expect(mockStore.markFixturePrompted).not.toHaveBeenCalledWith(1);
  });

  it('should skip AI calls when every open fixture was already prompted', async () => {
    mockStore.getPromptedFixtures.mockResolvedValue([1, 2]);

    await scheduler.runPoll(mockClient);

    expect(fetchMatchAiPrediction).not.toHaveBeenCalled();
    expect(mockStore.markFixturePrompted).not.toHaveBeenCalled();
  });
});
