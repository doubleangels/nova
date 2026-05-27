describe('worldCupTeamFlags', () => {
  let flags;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ predictionMockApi: false }));
    flags = require('../../utils/worldCupTeamFlags');
  });

  it('should convert ISO2 codes to flag emoji', () => {
    expect(flags.iso2ToFlagEmoji('BR')).toBe('🇧🇷');
    expect(flags.iso2ToFlagEmoji('US')).toBe('🇺🇸');
    expect(flags.iso2ToFlagEmoji('GB')).toBe('🇬🇧');
  });

  it('should resolve ISO2 from team names and TLAs', () => {
    expect(flags.iso2FromName('Brazil')).toBe('BR');
    expect(flags.iso2FromTla('BRA')).toBe('BR');
    expect(flags.iso2FromName('United States')).toBe('US');
    expect(flags.resolveIso2FromTeam({ name: 'Germany', tla: 'GER' })).toBe('DE');
    expect(flags.resolveIso2FromTeam({
      name: 'France',
      area: { code: 'FRA' }
    })).toBe('FR');
  });

  it('should prefix real teams with flags when mock API is off', () => {
    expect(flags.formatTeamWithFlag('Brazil', { mockApi: false, iso2: 'BR' }))
      .toBe('🇧🇷 Brazil');
  });

  it('should use stable random country flags for mock API teams', () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ predictionMockApi: true }));
    flags = require('../../utils/worldCupTeamFlags');

    const mockvilleIso = flags.mockIso2ForTeamName('Mockville United');
    const mockville = flags.formatTeamWithFlag('Mockville United');
    expect(mockville).toBe(`${flags.iso2ToFlagEmoji(mockvilleIso)} Mockville United`);
    expect(flags.formatTeamWithFlag('Mockville United')).toBe(mockville);

    const demovakia = flags.formatFixtureTeam(
      { home: 'Sampleland', away: 'Demovakia' },
      'away'
    );
    expect(demovakia).toBe(
      `${flags.iso2ToFlagEmoji(flags.mockIso2ForTeamName('Demovakia'))} Demovakia`
    );
    expect(flags.mockIso2ForTeamName('Demovakia')).not.toBe(mockvilleIso);
  });

  it('should assign mock ISO codes from the country pool', () => {
    const pool = flags.getMockIso2Pool();
    expect(pool.length).toBeGreaterThan(50);
    expect(pool).toContain('BR');
    expect(flags.mockIso2ForTeamName('Mockville United')).toMatch(/^[A-Z]{2}$/);
  });

  it('should return plain name when no flag mapping exists', () => {
    expect(flags.formatTeamWithFlag('Unknown FC', { mockApi: false })).toBe('Unknown FC');
  });
});
