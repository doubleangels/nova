describe('footballCompetitions', () => {
  let competitions;

  beforeEach(() => {
    jest.resetModules();
    competitions = require('../../utils/footballCompetitions');
  });

  it('should default to all four leagues', () => {
    expect(competitions.parseCompetitionCodes()).toEqual(['PL', 'BL1', 'PD', 'CL']);
  });

  it('should parse custom comma-separated codes', () => {
    expect(competitions.parseCompetitionCodes('PL, CL')).toEqual(['PL', 'CL']);
  });

  it('should ignore unknown codes', () => {
    expect(competitions.parseCompetitionCodes('PL,XX,BL1')).toEqual(['PL', 'BL1']);
  });

  it('should resolve competition names', () => {
    expect(competitions.getCompetitionName('PL')).toBe('Premier League');
    expect(competitions.getCompetitionName('CL')).toBe('UEFA Champions League');
  });
});
