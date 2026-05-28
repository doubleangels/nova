const msgs = require('../../utils/predictionMessages');

describe('predictionMessages', () => {
  it('should build game-specific not-configured errors', () => {
    expect(msgs.errNotConfigured('worldcup')).toContain('World Cup');
    expect(msgs.errNotConfigured('club')).toContain('Club football');
  });

  it('should build role ping with role id', () => {
    expect(msgs.buildRolePing('123')).toBe(
      '<@&123> A new match is open for predictions - submit yours before kickoff.'
    );
  });

  it('should format reset description for repost outcomes', () => {
    expect(msgs.buildResetDescription('worldcup', false, false, false)).toContain(
      'were not re-posted'
    );
    expect(msgs.buildResetDescription('club', true, true, false)).toContain('re-posted');
    expect(msgs.buildResetDescription('club', true, false, true)).toContain('not configured');
    expect(msgs.buildResetDescription('club', true, false, false)).not.toContain('re-posted in the prediction channel');
  });

  it('should format my pick lines', () => {
    expect(msgs.formatMyPickLine(2, 1, 'Home', true, 4)).toContain('+4');
    expect(msgs.formatMyPickLine(0, 0, 'Draw', false)).toContain('awaiting final score');
  });

  it('should build register embed copy', () => {
    expect(msgs.buildRegisterSuccessDescription('worldcup', '<#1>', 'Predictor')).toContain(
      'World Cup'
    );
    expect(msgs.buildRegisterSuccessDescription('club', '<#1>', 'Predictor')).toContain(
      'Club football'
    );
    expect(msgs.buildRegisterAlreadyDescription('worldcup')).toContain('already registered');
    expect(msgs.buildRegisterAlreadyDescription('club')).toContain('already registered');
  });

  it('should return worldcup prompt title without competition', () => {
    expect(msgs.buildPromptTitle('worldcup')).toBe('World Cup - match open');
  });

  it('should return club prompt title with competition label', () => {
    expect(msgs.buildPromptTitle('club', 'Premier League')).toBe('Premier League - match open');
  });

  it('should return default club prompt title when no competition', () => {
    expect(msgs.buildPromptTitle('club')).toBe('Club football - match open');
  });

  it('should build prediction form content with resultPick only', () => {
    const formatTeam = (_f, side) => (side === 'home' ? 'Arsenal' : 'Chelsea');
    const formatResultPick = (_f, pick) => (pick === 'home' ? 'Arsenal' : pick);
    const content = msgs.buildPredictionFormContentWithPick(
      { home: 'Arsenal', away: 'Chelsea' },
      formatTeam,
      formatResultPick,
      { resultPick: 'home', homeScore: null, awayScore: null }
    );
    expect(content).toContain('Winner: **Arsenal**');
    expect(content).toContain('Choose home goals');
  });

  it('should show saving message when prediction is complete', () => {
    const formatTeam = (_f, side) => (side === 'home' ? 'Arsenal' : 'Chelsea');
    const formatResultPick = (_f, _pick) => 'Arsenal';
    const content = msgs.buildPredictionFormContentWithPick(
      { home: 'Arsenal', away: 'Chelsea' },
      formatTeam,
      formatResultPick,
      { homeScore: 2, awayScore: 1, resultPick: 'home' }
    );
    expect(content).toContain('Score: **2-1**');
    expect(content).toContain('Saving your prediction');
  });

  it('should build form content with no pending picks', () => {
    const formatTeam = (_f, side) => (side === 'home' ? 'Arsenal' : 'Chelsea');
    const content = msgs.buildPredictionFormContentWithPick(
      { home: 'Arsenal', away: 'Chelsea' },
      formatTeam,
      () => '',
      null
    );
    expect(content).toContain('Choose home goals');
  });

  it('should build rules description for worldcup and club', () => {
    expect(msgs.buildRulesDescription('worldcup')).toContain('Join');
    const club = msgs.buildRulesDescription('club');
    expect(club).toContain('Premier League');
    expect(club).toContain('Demo mode');
  });

  it('should build buildResultsFooter for both game types', () => {
    expect(msgs.buildResultsFooter('worldcup')).toContain('/worldcup leaderboard');
    expect(msgs.buildResultsFooter('club')).toContain('/football leaderboard');
  });

  it('should truncate reasoning when value too long but reasoningBudget >= 24 (lines 337-339)', () => {
    // scoreLine with 140-char team names ≈ 289 chars → value = 289+4+120 = 413 > 400
    // reasoningBudget = 400 - 289 - 4 = 107 >= 24 → hits the if-branch
    const longName = 'A'.repeat(140);
    const formatTeam = (_f, side) => side === 'home' ? longName : longName;
    const value = msgs.formatAiPredictionField(
      { home: longName, away: longName },
      { homeScore: 1, awayScore: 0, resultPick: 'home', reasoning: 'x'.repeat(500), model: 'g' },
      formatTeam
    );
    expect(value.length).toBeLessThanOrEqual(msgs.AI_FIELD_MAX_LENGTH);
    expect(value).toContain(longName); // scoreLine preserved, reasoning truncated
  });

  it('should truncate entire value when reasoningBudget < 24 (lines 340-341)', () => {
    // scoreLine with 190-char team names ≈ 389 chars → reasoningBudget = 400-389-4 = 7 < 24
    const veryLongName = 'B'.repeat(190);
    const formatTeam = (_f, side) => side === 'home' ? veryLongName : veryLongName;
    const value = msgs.formatAiPredictionField(
      { home: veryLongName, away: veryLongName },
      { homeScore: 0, awayScore: 0, resultPick: 'draw', reasoning: 'x'.repeat(500), model: 'g' },
      formatTeam
    );
    expect(value.length).toBeLessThanOrEqual(msgs.AI_FIELD_MAX_LENGTH);
  });

  it('should format draw result in formatAiPredictionField (line 325-326)', () => {
    const fmt = (_f, side) => side === 'home' ? 'Team A' : 'Team B';
    const value = msgs.formatAiPredictionField(
      { home: 'Team A', away: 'Team B' },
      { homeScore: 1, awayScore: 1, resultPick: 'draw', reasoning: 'Even match.', model: 'g' },
      fmt
    );
    expect(value).toContain('Draw');
  });

  it('should return scoreLine only when reasoning is empty (lines 329-333 false branches)', () => {
    const fmt = (_f, side) => side === 'home' ? 'Arsenal' : 'Chelsea';
    const value = msgs.formatAiPredictionField(
      { home: 'Arsenal', away: 'Chelsea' },
      { homeScore: 2, awayScore: 0, resultPick: 'home', reasoning: '', model: 'g' },
      fmt
    );
    // No reasoning → value = scoreLine only, no newline+italic
    expect(value).not.toContain('\n');
  });

  it('should return scoreLine only when reasoning is null (line 329 null branch)', () => {
    const fmt = (_f, side) => side === 'home' ? 'Arsenal' : 'Chelsea';
    const value = msgs.formatAiPredictionField(
      { home: 'Arsenal', away: 'Chelsea' },
      { homeScore: 2, awayScore: 0, resultPick: 'home', reasoning: null, model: 'g' },
      fmt
    );
    expect(value).toBe('**Arsenal 2-0 Chelsea**');
  });

  it('should pass short text through truncateForEmbed without truncation (line 48 false branch)', () => {
    // truncateForEmbed is private; test via formatAiPredictionField with short reasoning
    const fmt = (_f, side) => side === 'home' ? 'A' : 'B';
    const value = msgs.formatAiPredictionField(
      { home: 'A', away: 'B' },
      { homeScore: 1, awayScore: 0, resultPick: 'home', reasoning: 'Short.', model: 'g' },
      fmt
    );
    expect(value).toContain('Short.');
  });

  it('should handle falsy text in truncateForEmbed (line 48 falsy text)', () => {
    // test falsy input to truncateForEmbed directly
    expect(msgs.truncateForEmbed(null, 10)).toBe('');
    expect(msgs.truncateForEmbed(undefined, 10)).toBe('');
  });

  it('should build prediction form content with null pending (line 224)', () => {
    const formatTeam = (_f, side) => side === 'home' ? 'Arsenal' : 'Chelsea';
    const formatResultPick = (_f, p) => p;
    const content = msgs.buildPredictionFormContentWithPick(
      { home: 'Arsenal', away: 'Chelsea' },
      formatTeam,
      formatResultPick,
      null
    );
    expect(content).toContain('Arsenal');
  });
});
