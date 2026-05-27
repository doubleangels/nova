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
  });
});
