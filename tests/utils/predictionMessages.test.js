const msgs = require('../../utils/predictionMessages');

describe('predictionMessages', () => {

  it('should format reposted prompt message', () => {
    expect(msgs.msgPromptReposted('Brazil vs Argentina')).toContain('Brazil vs Argentina');
  });

  it('should build admin-only add events and prompt errors', () => {
    expect(msgs.errAdminAddEventsOnly('worldcup')).toContain('Discord events');
    expect(msgs.errAdminAddPredictionOnly('club')).toContain('add');
    expect(msgs.errAdminFixScoringOnly('worldcup')).toContain('fix');
    expect(msgs.ERR_FIXTURE_NOT_FOUND).toContain('not found');
    expect(msgs.errAdminPromptOnly('club')).toContain('re-post');
    expect(msgs.errAdminRepostScoreOnly('worldcup')).toContain('final score');
  });

  it('should format reposted score message', () => {
    expect(msgs.msgScoreReposted('Brazil 2-1 Argentina')).toContain('Brazil 2-1 Argentina');
  });

  it('should build add events summary with error preview', () => {
    expect(msgs.buildAddEventsDescription(1, 2, 0)).toContain('**Created:** 1');
    const manyErrors = Array.from({ length: 7 }, (_, i) => `err ${i}`);
    const summary = msgs.buildAddEventsDescription(0, 0, 7, manyErrors);
    expect(summary).toContain('err 0');
    expect(summary).toContain('2 more');
    expect(msgs.buildAddEventsDescription(0, 0, 3, ['a', 'b', 'c'])).not.toContain('more');
  });

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
    expect(msgs.formatMyPickLine(1, 0, 'Home', true)).toContain('+0');
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
    expect(msgs.buildAddPredictionSuccessDescription({
      userId: '123',
      fixtureLine: 'A vs B',
      pickLine: '**Pick:** 2-1 (Home)',
      scoredNow: true,
      pointsDelta: 2,
      matchPoints: 3,
      totalPoints: 5,
      overwritten: true
    })).toContain('Replaced an existing prediction');
    expect(msgs.buildAddPredictionSuccessDescription({
      userId: '123',
      fixtureLine: 'A vs B',
      pickLine: '**Pick:** 2-1 (Home)',
      scoredNow: false,
      pointsDelta: 0,
      matchPoints: 0,
      totalPoints: 0,
      overwritten: false
    })).toContain('Match not finished yet');
    expect(msgs.buildAddPredictionSuccessDescription({
      userId: '123',
      fixtureLine: 'A vs B',
      pickLine: '**Pick:** 2-1 (Home)',
      scoredNow: true,
      pointsDelta: -2,
      matchPoints: 1,
      totalPoints: 1,
      overwritten: false
    })).toContain('Leaderboard change:** -2');
    expect(msgs.buildFixScoringSummaryDescription({
      fixtureId: 537371,
      wrong: '5-1',
      correct: '4-1',
      namespaces: ['worldcup'],
      namespaceWarning: null,
      totalChanges: 0,
      netDelta: 0,
      anyCommitted: false,
      reportTruncated: false
    })).toContain('No point adjustments were needed');
    expect(msgs.buildFixScoringSummaryDescription({
      fixtureId: 537371,
      wrong: '5-1',
      correct: '4-1',
      namespaces: ['worldcup'],
      namespaceWarning: null,
      totalChanges: 1,
      netDelta: 2,
      anyCommitted: true,
      reportTruncated: false
    })).toContain('Changes were written to the database');
    expect(msgs.buildFixScoringSummaryDescription({
      fixtureId: 537371,
      wrong: '5-1',
      correct: '4-1',
      namespaces: ['worldcup'],
      namespaceWarning: 'Warning: no predictions in football',
      totalChanges: 2,
      netDelta: 3,
      anyCommitted: true,
      reportTruncated: true
    })).toContain('Full report attached');
    expect(msgs.buildFixScoringSummaryDescription({
      fixtureId: 537371,
      wrong: '5-1',
      correct: '4-1',
      namespaces: [],
      namespaceWarning: null,
      totalChanges: 0,
      netDelta: 0,
      anyCommitted: false,
      reportTruncated: false
    })).toContain('(none)');
    expect(msgs.buildFixScoringSummaryDescription({
      fixtureId: 537371,
      wrong: '5-1',
      correct: '4-1',
      namespaces: ['worldcup'],
      namespaceWarning: null,
      totalChanges: 2,
      netDelta: -3,
      anyCommitted: true,
      reportTruncated: false
    })).toContain('**2** user(s) adjusted by **-3** points total');
  });

  it('should return worldcup prompt title without competition', () => {
    expect(msgs.buildPromptTitle('worldcup')).toBe('World Cup - Match Open');
  });

  it('should return club prompt title with competition label', () => {
    expect(msgs.buildPromptTitle('club', 'Premier League')).toBe('Premier League - Match Open');
  });

  it('should return default club prompt title when no competition', () => {
    expect(msgs.buildPromptTitle('club')).toBe('Club Football - Match Open');
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

    const contentUndefined = msgs.buildPredictionFormContentWithPick(
      { home: 'Arsenal', away: 'Chelsea' },
      formatTeam,
      () => ''
    );
    expect(contentUndefined).toContain('Choose home goals');
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
    const worldcup = msgs.buildRulesDescription('worldcup');
    expect(worldcup).toContain('Join');
    expect(worldcup).toContain('max 3 points');
    expect(worldcup).toContain('Correct winner pick - **1** point');
    expect(worldcup).toContain('Exact score - **2** additional points');
    const club = msgs.buildRulesDescription('club');
    expect(club).toContain('Premier League');
    expect(club).toContain('Demo mode');
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
    expect(msgs.truncateForEmbed(null, 10)).toBe('');
    expect(msgs.truncateForEmbed(undefined, 10)).toBe('');
  });

  it('should truncate long text in truncateForEmbed', () => {
    expect(msgs.truncateForEmbed('abcdefghij', 5)).toBe('abcd…');
    expect(msgs.truncateForEmbed('  padded  ', 8)).toBe('padded');
  });

  it('should show score line when pending has goals but no winner yet', () => {
    const formatTeam = (_f, side) => (side === 'home' ? 'Arsenal' : 'Chelsea');
    const content = msgs.buildPredictionFormContentWithPick(
      { home: 'Arsenal', away: 'Chelsea' },
      formatTeam,
      () => '',
      { homeScore: 1, awayScore: 0, resultPick: null }
    );
    expect(content).toContain('Score: **1-0**');
    expect(content).toContain('Choose home goals');
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
  describe('Uncovered utility functions', () => {
    it('should format errRegisterFirst', () => {
      expect(msgs.errRegisterFirst('worldcup')).toContain('Run /worldcup register first');
    });

    it('should format msgEmptyLeaderboard', () => {
      expect(msgs.msgEmptyLeaderboard('club')).toContain('Run /football register to join');
    });

    it('should format prediction listing helpers', () => {
      expect(msgs.msgNoPredictionsForUser('Alice')).toContain('Alice has not submitted');
      expect(msgs.predictionsTitleOther('Bob')).toBe("Bob's Predictions");
    });

    it('should format errAdminResetOnly', () => {
      expect(msgs.errAdminResetOnly('worldcup')).toContain('Only administrators can reset world cup');
    });

    it('should format buildPromptDescription', () => {
      const formatTeam = jest.fn((fix, side) => `${side}Team`);
      const desc = msgs.buildPromptDescription({}, formatTeam);
      expect(desc).toContain('homeTeam');
      expect(desc).toContain('awayTeam');
      expect(desc).toContain('Tap **Submit Prediction**');
    });

    it('should format formatPointsEarnedField with no earners', () => {
      expect(msgs.formatPointsEarnedField([])).toBe('Nobody scored points on this match.');
    });

    it('should format formatPointsEarnedField with earners sorted by total', () => {
      const earners = [
        { userId: '1', scorePoints: 0, resultPoints: 1, total: 1 },
        { userId: '2', scorePoints: 2, resultPoints: 1, total: 3 }
      ];
      const result = msgs.formatPointsEarnedField(earners);
      expect(result).toContain('<@2> - **+3** pts (2 score, 1 result)');
      expect(result).toContain('<@1> - **+1** pts (0 score, 1 result)');
      expect(result.indexOf('<@2>')).toBeLessThan(result.indexOf('<@1>')); // Sorting check
    });

    it('should format winnerPlaceholderSelected', () => {
      expect(msgs.winnerPlaceholderSelected('Draw')).toBe('Winner: Draw');
    });
  });

  describe('remove user messages', () => {
    const emptySummary = {
      hadData: false,
      wasRegistered: false,
      predictionCount: 0,
      pendingCount: 0,
      points: 0
    };

    it('should build no-data message', () => {
      expect(msgs.msgRemoveUserNoData('123456789012345678')).toContain(
        'No World Cup or club football prediction data found'
      );
    });

    it('should build remove user description with no-data sections', () => {
      const desc = msgs.buildRemoveUserDescription('123456789012345678', emptySummary, emptySummary);
      expect(desc).toContain('**World Cup:** no data');
      expect(desc).toContain('**Club football:** no data');
    });

    it('should build remove user description with pending picks cleared', () => {
      const desc = msgs.buildRemoveUserDescription('123456789012345678', {
        hadData: true,
        wasRegistered: false,
        predictionCount: 0,
        pendingCount: 2,
        points: 0
      }, emptySummary);
      expect(desc).toContain('Cleared 2 in-progress pick(s)');
    });

    it('should build remove user description for zero-point cleanup', () => {
      const desc = msgs.buildRemoveUserDescription('123456789012345678', {
        hadData: true,
        wasRegistered: false,
        predictionCount: 0,
        pendingCount: 0,
        points: 0
      }, emptySummary);
      expect(desc).toContain('Cleared stored points');
    });

    it('should export admin remove user error constants', () => {
      expect(msgs.ERR_ADMIN_REMOVE_USER_ONLY).toContain('administrators');
      expect(msgs.ERR_INVALID_USER_ID).toContain('valid Discord user ID');
    });
  });
});
