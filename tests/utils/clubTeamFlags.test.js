const {
  iso2FromClubName,
  iso2FromClubTla,
  resolveClubIso2FromTeam
} = require('../../utils/clubTeamFlags');

describe('clubTeamFlags', () => {
  it('should resolve La Liga teams from API names', () => {
    expect(iso2FromClubName('Rayo Vallecano de Madrid')).toBe('ES');
    expect(iso2FromClubName('Real Oviedo')).toBe('ES');
    expect(iso2FromClubName('RCD Mallorca')).toBe('ES');
    expect(iso2FromClubName('Deportivo Alavés')).toBe('ES');
    expect(iso2FromClubName('RC Celta de Vigo')).toBe('ES');
    expect(iso2FromClubName('Getafe CF')).toBe('ES');
    expect(iso2FromClubName('Levante UD')).toBe('ES');
  });

  it('should resolve Premier League teams missing from generic TLA map', () => {
    expect(iso2FromClubName('Sunderland AFC')).toBe('GB');
    expect(iso2FromClubName('Burnley FC')).toBe('GB');
    expect(iso2FromClubTla('SUN', 'PL')).toBe('GB');
    expect(iso2FromClubTla('BUR', 'PL')).toBe('GB');
  });

  it('should scope ambiguous TLAs by competition', () => {
    expect(iso2FromClubTla('LEV', 'PD')).toBe('ES');
    expect(iso2FromClubTla('LEV', 'BL1')).toBe('DE');
    expect(iso2FromClubTla('FCB', 'BL1')).toBe('DE');
    expect(iso2FromClubTla('FCB', 'PD')).toBe('ES');
    expect(iso2FromClubTla('CEL', 'PD')).toBe('ES');
  });

  it('should prefer name over Leverkusen TLA for Levante', () => {
    expect(
      resolveClubIso2FromTeam({ name: 'Levante UD', tla: 'LEV' }, 'PD')
    ).toBe('ES');
  });

  it('should fall back to league default for unknown PL club names', () => {
    expect(
      resolveClubIso2FromTeam({ name: 'Mystery Town FC', tla: 'ZZZ' }, 'PL')
    ).toBe('GB');
  });

  it('should not assign German flag to Levante via global TLA', () => {
    expect(
      resolveClubIso2FromTeam({ name: 'Levante UD', shortName: 'Levante', tla: 'LEV' })
    ).toBe('ES');
  });

  it('should return null when no ISO2 can be resolved (line 107)', () => {
    const fakeTeam = { area: { code: '???' }, name: 'Unknown FC', tla: '???' };
    expect(resolveClubIso2FromTeam(fakeTeam, 'UNKNOWN')).toBeNull();
  });

  it('should resolve from area code', () => {
    const { areaCodeToIso2 } = require('../../utils/clubTeamFlags');
    expect(areaCodeToIso2('ENG')).toBe('GB');
    expect(areaCodeToIso2('GB')).toBe('GB');
    expect(areaCodeToIso2(null)).toBeNull();
  });

  it('should handle empty or invalid names in clubNameLookupKeys (lines 28-32)', () => {
    const { clubNameLookupKeys } = require('../../utils/clubTeamFlags');
    expect(clubNameLookupKeys(null)).toEqual([]);
    expect(clubNameLookupKeys('   ')).toEqual([]);
    expect(clubNameLookupKeys(123)).toEqual([]);
  });

  it('should handle empty or invalid TLAs in iso2FromClubTla (lines 72-74)', () => {
    expect(iso2FromClubTla(null)).toBeNull();
    expect(iso2FromClubTla('   ')).toBeNull();
    expect(iso2FromClubTla(123)).toBeNull();
  });

  it('should handle invalid team objects in resolveClubIso2FromTeam (line 91)', () => {
    expect(resolveClubIso2FromTeam(null)).toBeNull();
    expect(resolveClubIso2FromTeam('not-an-object')).toBeNull();
  });

  it('should resolve from TLA fallback (line 101)', () => {
    // Need a team with no area, no recognizable name, but a recognized TLA.
    const fakeTeam = { tla: 'MUN' }; // Manchester United
    expect(resolveClubIso2FromTeam(fakeTeam)).toBe('GB');
  });
});
