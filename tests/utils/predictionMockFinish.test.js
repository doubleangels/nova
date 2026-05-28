describe('predictionMockFinish', () => {
  let applyMockInstantFinishToFixtures;
  let mockStore;
  let mockData;

  const fixtures = [
    { id: 1, status: 'NS', goals: { home: null, away: null } },
    { id: 2, status: 'NS', goals: { home: null, away: null } }
  ];

  beforeEach(() => {
    jest.resetModules();
    mockStore = {
      areAllMockPlayableFixturesPredicted: jest.fn().mockResolvedValue(true)
    };
    mockData = {
      isMockPlayableMatchId: jest.fn().mockReturnValue(true),
      getMockScriptedFullTimeGoals: jest.fn().mockReturnValue({ home: 2, away: 1 })
    };
  });

  it('should return fixtures unchanged when predictionMockApi is false', async () => {
    jest.doMock('../../config', () => ({ predictionMockApi: false }));
    ({ applyMockInstantFinishToFixtures } = require('../../utils/predictionMockFinish'));
    const result = await applyMockInstantFinishToFixtures(mockStore, [1, 2], mockData, fixtures);
    expect(result).toBe(fixtures);
    expect(mockStore.areAllMockPlayableFixturesPredicted).not.toHaveBeenCalled();
  });

  it('should return fixtures unchanged when not all mock fixtures are predicted', async () => {
    jest.doMock('../../config', () => ({ predictionMockApi: true }));
    mockStore.areAllMockPlayableFixturesPredicted.mockResolvedValue(false);
    ({ applyMockInstantFinishToFixtures } = require('../../utils/predictionMockFinish'));
    const result = await applyMockInstantFinishToFixtures(mockStore, [1, 2], mockData, fixtures);
    expect(result).toBe(fixtures);
  });

  it('should set status to FT with scripted goals for mock playable fixtures', async () => {
    jest.doMock('../../config', () => ({ predictionMockApi: true }));
    ({ applyMockInstantFinishToFixtures } = require('../../utils/predictionMockFinish'));
    const result = await applyMockInstantFinishToFixtures(mockStore, [1, 2], mockData, fixtures);
    expect(result[0].status).toBe('FT');
    expect(result[0].goals).toEqual({ home: 2, away: 1 });
  });

  it('should leave non-mock fixtures unchanged', async () => {
    jest.doMock('../../config', () => ({ predictionMockApi: true }));
    mockData.isMockPlayableMatchId.mockReturnValue(false);
    ({ applyMockInstantFinishToFixtures } = require('../../utils/predictionMockFinish'));
    const result = await applyMockInstantFinishToFixtures(mockStore, [1, 2], mockData, fixtures);
    expect(result[0].status).toBe('NS');
  });

  it('should leave fixture unchanged when getMockScriptedFullTimeGoals returns null', async () => {
    jest.doMock('../../config', () => ({ predictionMockApi: true }));
    mockData.getMockScriptedFullTimeGoals.mockReturnValue(null);
    ({ applyMockInstantFinishToFixtures } = require('../../utils/predictionMockFinish'));
    const result = await applyMockInstantFinishToFixtures(mockStore, [1, 2], mockData, fixtures);
    expect(result[0].status).toBe('NS');
  });
});
