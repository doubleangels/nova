describe('footballMockData', () => {
  let mockData;

  beforeEach(() => {
    jest.resetModules();
    mockData = require('../../utils/footballMockData');
  });

  it('should return one upcoming demo fixture with stable mock id', () => {
    const matches = mockData.getMockSeasonMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(910001);
    expect(matches[0].competition?.code).toBe('PL');
  });

  it('should include team area codes for country flags', () => {
    const matches = mockData.getMockSeasonMatches();
    expect(matches[0].homeTeam?.area?.code).toBe('ENG');
    expect(matches[0].awayTeam?.area?.code).toBe('ENG');
  });

  it('should expose scripted full-time score', () => {
    expect(mockData.getMockScriptedFullTimeGoals(910001)).toEqual({ home: 2, away: 1 });
    expect(mockData.getMockScriptedFullTimeGoals(123)).toBeNull();
  });

  it('should check if match id is playable (line 41)', () => {
    expect(mockData.isMockPlayableMatchId(910001)).toBe(true);
    expect(mockData.isMockPlayableMatchId(123)).toBe(false);
  });

  it('should get mock match by id (line 64)', () => {
    expect(mockData.getMockMatchById(910001)).toHaveProperty('id', 910001);
    expect(mockData.getMockMatchById(123)).toBeNull();
  });

  it('should refresh kickoff on each mock build', () => {
    jest.useFakeTimers();
    const first = mockData.buildMockMatches()[0].utcDate;
    jest.advanceTimersByTime(60_000);
    const second = mockData.buildMockMatches()[0].utcDate;
    expect(second).not.toBe(first);
    jest.useRealTimers();
  });
});
