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

    const sampleland = flags.formatFixtureTeam(
      { home: 'Sampleland', away: 'Demovakia' },
      'home'
    );
    expect(sampleland).toBe(
      `${flags.iso2ToFlagEmoji(flags.mockIso2ForTeamName('Sampleland'))} Sampleland`
    );
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

  it('should handle falsy/empty teamName', () => {
    // Tests: String(teamName || '').trim() || 'Team' (line 215)
    expect(flags.formatTeamWithFlag(null, { mockApi: false })).toBe('Team');
    expect(flags.formatTeamWithFlag('', { mockApi: false })).toBe('Team');
    expect(flags.formatTeamWithFlag('   ', { mockApi: false })).toBe('Team');
  });

  it('should handle mockIso2ForTeamName with falsy/empty teamName', () => {
    // Tests: if (!normalized || pool.length === 0) (line 23)
    expect(flags.mockIso2ForTeamName(null)).toBe('AE'); // Fallback to pool[0] if pool is not empty
  });

  it('should handle mockIso2ForTeamName with empty pool', () => {
    // Clear pool to test pool[0] || 'US'
    const originalIso2 = flags.NAME_TO_ISO2['usa'];
    flags.getMockIso2Pool().length = 0; // Empty the pool array
    expect(flags.mockIso2ForTeamName('Team')).toBe('US');
  });

  it('should handle iso2ToFlagEmoji edge cases', () => {
    // Tests line 138-140
    expect(flags.iso2ToFlagEmoji(null)).toBeNull();
    expect(flags.iso2ToFlagEmoji('A')).toBeNull(); // not length 2
    expect(flags.iso2ToFlagEmoji('12')).toBeNull(); // not A-Z
  });

  it('should handle iso2FromName edge cases', () => {
    // Tests lines 171-180
    expect(flags.iso2FromName(null)).toBeNull();
    expect(flags.iso2FromName('   ')).toBeNull();
    // Test suffix stripping ' national team'
    expect(flags.iso2FromName('Brazil National Team')).toBe('BR');
    expect(flags.iso2FromName('Chelsea FC')).toBe('GB');
    expect(flags.iso2FromName('Unknown National Team')).toBeNull();
  });

  it('should handle resolveIso2FromTeam edge cases', () => {
    // Tests line 190
    expect(flags.resolveIso2FromTeam(null)).toBeNull();
    expect(flags.resolveIso2FromTeam('not an object')).toBeNull();
  });
});

describe('codeToIso2 edge cases (via iso2FromTla)', () => {
  let flags;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ predictionMockApi: false }));
    flags = require('../../utils/worldCupTeamFlags');
  });

  it('should return null from iso2FromTla for code > 3 chars (line 155)', () => {
    // iso2FromTla → codeToIso2 → trimmed.length > 3 → return null
    expect(flags.iso2FromTla('TOOLONG')).toBeNull();
  });

  it('should return trimmed ISO2 when length is 2 (line 153)', () => {
    // Directly exercising the 2-char path
    expect(flags.resolveIso2FromTeam({ area: { code: 'br' }, name: 'Brazil' })).toBe('BR');
  });

  it('should resolve TLA to ISO2 when length is 3 (line 154)', () => {
    expect(flags.iso2FromTla('BRA')).toBe('BR');
  });

  it('should return null from resolveIso2FromTeam when area code has > 3 chars', () => {
    // area.code='TOOLONG' → codeToIso2 returns null → falls through to name/tla lookup
    const result = flags.resolveIso2FromTeam({ area: { code: 'TOOLONG' }, name: 'Unknown' });
    expect(result).toBeNull(); // 'Unknown' not in NAME_TO_ISO2, no tla
  });

  it('should handle codeToIso2 with falsy input', () => {
    // TLA length === 3 but not in map (line 154)
    expect(flags.iso2FromTla('ZZZ')).toBeNull();
    expect(flags.iso2FromTla(null)).toBeNull();
  });
});
