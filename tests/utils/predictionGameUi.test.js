describe('predictionGameUi', () => {
  let ui;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ baseEmbedColor: 0xABCDEF, predictionReminderHours: 24 }));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    ui = require('../../utils/predictionGameUi');
  });

  const formatTeam = (_fixture, side) => side === 'home' ? '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Arsenal' : '🔵 Chelsea';

  describe('formatDiscordTimestamp', () => {
    it('should format valid ISO date as Discord timestamp', () => {
      expect(ui.formatDiscordTimestamp('2026-06-01T12:00:00Z')).toMatch(/^<t:\d+:f>$/);
    });

    it('should return TBD for invalid date (line 15)', () => {
      expect(ui.formatDiscordTimestamp('not-a-date')).toBe('TBD');
      expect(ui.formatDiscordTimestamp('')).toBe('TBD');
    });
  });

  describe('truncateModalLabel', () => {
    it('should not truncate short labels', () => {
      expect(ui.truncateModalLabel('Short', 45)).toBe('Short');
    });

    it('should truncate and add ellipsis for long labels', () => {
      const result = ui.truncateModalLabel('A'.repeat(50), 45);
      expect(result.length).toBeLessThanOrEqual(45);
      expect(result).toContain('…');
    });

    it('should handle null/empty text input (lines 63-64)', () => {
      expect(ui.truncateModalLabel(null, 45)).toBe('');
      expect(ui.truncateModalLabel('', 45)).toBe('');
    });

    it('should use default maxLength of 45', () => {
      const result = ui.truncateModalLabel('A'.repeat(50));
      expect(result.length).toBeLessThanOrEqual(45);
    });
  });

  describe('formatFixtureLine', () => {
    const fixture = {
      id: 1, home: 'Arsenal', away: 'Chelsea',
      kickoff: '2026-06-01T12:00:00Z', status: 'NS',
      goals: { home: null, away: null }
    };

    it('should format with a prefix function', () => {
      const line = ui.formatFixtureLine(fixture, formatTeam, () => '[PL] ');
      expect(line).toContain('[PL]');
    });

    it('should format without a prefix function (line 79)', () => {
      const line = ui.formatFixtureLine(fixture, formatTeam, undefined);
      expect(line).toContain('Arsenal');
      expect(line).toContain('Chelsea');
    });
  });

  describe('buildPromptEmbed', () => {
    const fixture = {
      id: 1, home: 'Arsenal', away: 'Chelsea',
      kickoff: '2026-06-01T12:00:00Z', status: 'NS',
      goals: { home: null, away: null }
    };

    it('should build embed without formatLinePrefix (line 104)', () => {
      const embed = ui.buildPromptEmbed('worldcup', fixture, formatTeam, undefined, {});
      expect(embed.data.title).toContain('World Cup');
    });

    it('should build club embed with competition', () => {
      const clubFixture = { ...fixture, competitionName: 'Premier League' };
      const embed = ui.buildPromptEmbed('club', clubFixture, formatTeam, undefined, {});
      expect(embed.data.title).toContain('Premier League');
    });
  });

  describe('parseResultPick', () => {
    it('should match by formatted team name via formatTeam (lines 179-183)', () => {
      const fixture = { home: 'Arsenal', away: 'Chelsea' };
      expect(ui.parseResultPick('🏴󠁧󠁢󠁥󠁮󠁧󠁿 arsenal', fixture, formatTeam)).toBe('home');
      expect(ui.parseResultPick('🔵 chelsea', fixture, formatTeam)).toBe('away');
    });

    it('should match by raw fixture name before trying formatTeam', () => {
      const fixture = { home: 'Arsenal', away: 'Chelsea' };
      expect(ui.parseResultPick('arsenal', fixture, formatTeam)).toBe('home');
      expect(ui.parseResultPick('chelsea', fixture, formatTeam)).toBe('away');
    });

    it('should match draw and shorthand keys without fixture', () => {
      expect(ui.parseResultPick('draw')).toBe('draw');
      expect(ui.parseResultPick('d')).toBe('draw');
      expect(ui.parseResultPick('h')).toBe('home');
      expect(ui.parseResultPick('a')).toBe('away');
      expect(ui.parseResultPick('xyz')).toBeNull();
    });

    it('should handle fixture with no formatTeam (lines 174-175)', () => {
      const fixture = { home: 'Arsenal', away: 'Chelsea' };
      expect(ui.parseResultPick('arsenal', fixture, null)).toBe('home');
      expect(ui.parseResultPick('chelsea', fixture, null)).toBe('away');
    });
  });

  describe('formatResultPickDisplay', () => {
    it('should return home team label for home pick', () => {
      expect(ui.formatResultPickDisplay({ home: 'Arsenal', away: 'Chelsea' }, formatTeam, 'home'))
        .toContain('Arsenal');
    });

    it('should return away team label for away pick', () => {
      expect(ui.formatResultPickDisplay({ home: 'Arsenal', away: 'Chelsea' }, formatTeam, 'away'))
        .toContain('Chelsea');
    });

    it('should return Draw for draw pick', () => {
      expect(ui.formatResultPickDisplay({ home: 'Arsenal', away: 'Chelsea' }, formatTeam, 'draw'))
        .toBe('Draw');
    });

    it('should return raw pick value as fallback (line 93)', () => {
      expect(ui.formatResultPickDisplay({ home: 'Arsenal', away: 'Chelsea' }, formatTeam, 'tbd'))
        .toBe('tbd');
    });
  });

  describe('isPendingPredictionComplete', () => {
    it('should return true when all three fields present', () => {
      expect(ui.isPendingPredictionComplete({ homeScore: 1, awayScore: 0, resultPick: 'home' })).toBe(true);
    });

    it('should return false when any field missing', () => {
      expect(ui.isPendingPredictionComplete({ homeScore: 1, awayScore: 0 })).toBe(false);
      expect(ui.isPendingPredictionComplete(null)).toBe(false);
    });
  });

  describe('goalsModalLabel', () => {
    it('should return label ending in goals', () => {
      expect(ui.goalsModalLabel('Arsenal')).toBe('Arsenal goals');
    });

    it('should truncate very long team names', () => {
      const label = ui.goalsModalLabel('A'.repeat(60));
      expect(label.length).toBeLessThanOrEqual(45);
    });
  });
});
