describe('worldCupMockData', () => {
  let mockData;

  beforeEach(() => {
    jest.resetModules();
    mockData = require('../../utils/worldCupMockData');
  });

  it('should return one upcoming demo fixture with stable mock id', () => {
    const matches = mockData.getMockSeasonMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(900001);
    expect(matches[0].status).toBe('TIMED');
  });

  it('should expose scripted full-time scores for playable matches', () => {
    expect(mockData.getMockScriptedFullTimeGoals(900001)).toEqual({ home: 2, away: 1 });
    expect(mockData.getMockScriptedFullTimeGoals(999999)).toBeNull();
  });

  it('should include team area codes for country flags', () => {
    const matches = mockData.getMockSeasonMatches();
    expect(matches[0].homeTeam?.area?.code).toBe('BRA');
    expect(matches[0].awayTeam?.area?.code).toBe('ARG');
  });

  it('should look up a match by id', () => {
    const match = mockData.getMockMatchById(900001);
    expect(match?.homeTeam?.name).toBe('Brazil');
    expect(match?.awayTeam?.name).toBe('Argentina');
    expect(mockData.getMockMatchById(999999)).toBeNull();
  });

  it('should use a fresh kickoff on each mock build', () => {
    jest.useFakeTimers();
    const first = mockData.buildMockMatches()[0].utcDate;
    jest.advanceTimersByTime(60_000);
    const second = mockData.buildMockMatches()[0].utcDate;
    expect(second).not.toBe(first);
    jest.useRealTimers();
  });
});
