const {
  getDefaultFootballSeasonYear,
  getFootballSeasonCandidates
} = require('../../utils/footballSeason');

describe('footballSeason', () => {
  it('should use previous calendar year before August', () => {
    expect(getDefaultFootballSeasonYear(new Date('2026-05-27T12:00:00Z'))).toBe(
      2025
    );
    expect(getDefaultFootballSeasonYear(new Date('2026-01-15T12:00:00Z'))).toBe(
      2025
    );
  });

  it('should use current calendar year from August onward', () => {
    expect(getDefaultFootballSeasonYear(new Date('2025-08-01T12:00:00Z'))).toBe(
      2025
    );
    expect(getDefaultFootballSeasonYear(new Date('2025-12-01T12:00:00Z'))).toBe(
      2025
    );
  });

  it('should list primary season then previous year as fallback', () => {
    expect(getFootballSeasonCandidates(2026)).toEqual([2026, 2025]);
    expect(getFootballSeasonCandidates(2025)).toEqual([2025, 2024]);
  });

  it('should use default season when no primary season provided (line 27)', () => {
    // Should return default and default - 1
    const defaultYear = getDefaultFootballSeasonYear();
    expect(getFootballSeasonCandidates()).toEqual([defaultYear, defaultYear - 1]);
    expect(getFootballSeasonCandidates(null)).toEqual([defaultYear, defaultYear - 1]);
  });

  it('should not add previous year if primary season is not > 2000 (line 29 false branch)', () => {
    expect(getFootballSeasonCandidates(2000)).toEqual([2000]);
  });
});
