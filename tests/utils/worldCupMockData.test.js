describe('worldCupMockData', () => {
  let mockData;

  beforeEach(() => {
    jest.resetModules();
    mockData = require('../../utils/worldCupMockData');
  });

  it('should return five fixtures with stable mock ids', () => {
    const matches = mockData.getMockSeasonMatches();
    expect(matches).toHaveLength(5);
    expect(matches.map(m => m.id)).toEqual([900001, 900002, 900003, 900004, 900005]);
  });

  it('should include upcoming, live, finished, and postponed matches', () => {
    const matches = mockData.getMockSeasonMatches();
    expect(matches.some(m => m.status === 'TIMED')).toBe(true);
    expect(matches.some(m => m.status === 'FINISHED')).toBe(true);
    expect(matches.some(m => m.status === 'IN_PLAY')).toBe(true);
    expect(matches.some(m => m.status === 'POSTPONED')).toBe(true);
  });

  it('should look up a match by id', () => {
    const match = mockData.getMockMatchById(900002);
    expect(match?.homeTeam?.name).toBe('Sampleland');
    expect(mockData.getMockMatchById(999999)).toBeNull();
  });
});
