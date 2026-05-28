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

  it('should fallback to default codes when all provided codes are invalid', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(competitions.parseCompetitionCodes('XX,YY')).toEqual(['PL', 'BL1', 'PD', 'CL']);
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('should return the code itself if competition name is unknown', () => {
    expect(competitions.getCompetitionName('UNKNOWN')).toBe('UNKNOWN');
  });
});
