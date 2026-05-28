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
});
