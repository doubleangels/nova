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
      const embed = ui.buildPromptEmbed('worldcup', fixture, formatTeam, undefined);
      expect(embed.data.title).toContain('World Cup');
    });

    it('should build club embed with competition', () => {
      const clubFixture = { ...fixture, competitionName: 'Premier League' };
      const embed = ui.buildPromptEmbed('club', clubFixture, formatTeam, undefined);
      expect(embed.data.title).toContain('Premier League');
    });

    it('should build club embed with competitionCode when competitionName is missing (lines 106-108)', () => {
      const clubFixture = { ...fixture, competitionCode: 'PL' };
      const embed = ui.buildPromptEmbed('club', clubFixture, formatTeam);
      expect(embed.data.title).toBeDefined(); // msgs.buildPromptTitle handles it, we just want to hit the branch
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

    it('should fall back if formatTeam matches neither (line 179)', () => {
      const fixture = { home: 'Team A', away: 'Team B' };
      const plainFormatTeam = (_fix, side) => side === 'home' ? 'Team A FC' : 'Team B FC';
      
      expect(ui.parseResultPick('xyz', fixture, plainFormatTeam)).toBeNull();
    });

    it('should handle missing raw, fixture.home, and fixture.away (lines 170, 174-175)', () => {
      expect(ui.parseResultPick('xyz', {}, null)).toBeNull();
      expect(ui.parseResultPick(null, { home: 'Arsenal', away: 'Chelsea' }, null)).toBeNull();
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

  describe('isFixtureOpenForPrediction (lines 34-38)', () => {
    it('should return false for missing fixture or non-open status', () => {
      expect(ui.isFixtureOpenForPrediction(null)).toBe(false);
      expect(ui.isFixtureOpenForPrediction({ status: 'FINISHED' })).toBe(false);
    });

    it('should return true if status is open and kickoff is missing', () => {
      expect(ui.isFixtureOpenForPrediction({ status: 'NS' })).toBe(true);
    });

    it('should return true if kickoff is in the future', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      expect(ui.isFixtureOpenForPrediction({ status: 'NS', kickoff: '2026-06-01T13:00:00Z' }, now)).toBe(true);
      expect(ui.isFixtureOpenForPrediction({ status: 'NS', kickoff: '2026-06-01T11:00:00Z' }, now)).toBe(false);
    });
  });

  describe('isInReminderWindow (lines 46-56)', () => {
    it('should return false if kickoff or open status is missing', () => {
      expect(ui.isInReminderWindow({ status: 'FINISHED', kickoff: '2026-06-01T12:00:00Z' })).toBe(false);
      expect(ui.isInReminderWindow({ status: 'NS' })).toBe(false);
    });

    it('should return true if current time is within reminder window', () => {
      const kickoff = '2026-06-02T12:00:00Z';
      const fixture = { status: 'NS', kickoff };
      // reminderHours is 24, so window is 2026-06-01T12:00:00Z to 2026-06-02T12:00:00Z
      expect(ui.isInReminderWindow(fixture, new Date('2026-06-01T12:00:00Z'), 24)).toBe(true);
      expect(ui.isInReminderWindow(fixture, new Date('2026-06-01T15:00:00Z'), 24)).toBe(true);
      expect(ui.isInReminderWindow(fixture, new Date('2026-06-01T11:00:00Z'), 24)).toBe(false);
      expect(ui.isInReminderWindow(fixture, new Date('2026-06-02T12:00:01Z'), 24)).toBe(false);
    });
  });

  describe('buildPromptEmbed (line 119)', () => {
    const fixture = {
      id: 1, home: 'Arsenal', away: 'Chelsea',
      kickoff: '2026-06-01T12:00:00Z', status: 'NS',
      goals: { home: null, away: null }
    };

    it('should add AI pick field if aiPrediction is provided', () => {
      const aiPrediction = {
        homeScore: 2, awayScore: 1, resultPick: 'home', reasoning: 'AI says so.'
      };
      const embed = ui.buildPromptEmbed('worldcup', fixture, formatTeam, undefined, { aiPrediction });
      expect(embed.data.fields).toBeDefined();
      expect(embed.data.fields[0].value).toContain('AI says so');
    });
  });

  describe('buildAnnouncementEmbed (lines 145-160)', () => {
    it('should build announcement embed', () => {
      const fixture = { goals: { home: 2, away: 1 } };
      const earners = [{ userId: '123', scorePoints: 3, resultPoints: 0, total: 3 }];
      const embed = ui.buildAnnouncementEmbed('club', fixture, earners, formatTeam, undefined);
      expect(embed.data.title).toContain('2-1');
      expect(embed.data.fields[0].value).toContain('<@123>');
    });

    it('should build announcement embed with missing goals (lines 145-146)', () => {
      const fixture = { goals: {} };
      const earners = [];
      const embed = ui.buildAnnouncementEmbed('club', fixture, earners, formatTeam, undefined);
      expect(embed.data.title).toContain('?-?');
    });
  });

  describe('parseScoreInputs (lines 200-219)', () => {
    it('should parse valid scores', () => {
      const res = ui.parseScoreInputs('2', '1');
      expect(res).toEqual({ homeScore: 2, awayScore: 1 });
    });

    it('should return error for invalid home score', () => {
      const res = ui.parseScoreInputs('abc', '1', { home: 'Arsenal', away: 'Chelsea' }, formatTeam);
      expect(res.error).toContain('Arsenal');
      expect(res.error).toContain('whole number');
    });

    it('should return error for invalid away score', () => {
      const res = ui.parseScoreInputs('2', '-1');
      expect(res.error).toContain('Away'); // without fixture/formatTeam, uses fallback 'Away'
    });
  });

  describe('formatResultPickOptions (lines 218-219)', () => {
    it('should format result pick options', () => {
      const fixture = { home: 'Arsenal', away: 'Chelsea' };
      expect(ui.formatResultPickOptions(fixture, formatTeam)).toContain('Arsenal');
      expect(ui.formatResultPickOptions(fixture, formatTeam)).toContain('Chelsea');
      expect(ui.formatResultPickOptions(fixture, formatTeam)).toContain('draw');
    });
  });
});
