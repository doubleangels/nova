const msgs = require('../../utils/predictionMessages');

describe('formatAiPredictionField', () => {
  const formatTeam = (_fixture, side) => (side === 'home' ? 'Brazil' : 'Argentina');

  it('should use home-score-away wording', () => {
    const value = msgs.formatAiPredictionField(
      { home: 'Brazil', away: 'Argentina' },
      {
        homeScore: 1,
        awayScore: 2,
        resultPick: 'away',
        reasoning: 'Away side in form.',
        model: 'gemini-3.1-flash-lite'
      },
      formatTeam
    );
    expect(value).toContain('**Brazil 1-2 Argentina**');
    expect(value).not.toContain('winner');
    expect(value).not.toMatch(/[—–]/);
  });

  it('should append draw label for level scores', () => {
    const value = msgs.formatAiPredictionField(
      { home: 'Brazil', away: 'Argentina' },
      {
        homeScore: 1,
        awayScore: 1,
        resultPick: 'draw',
        reasoning: 'Even form on both sides.',
        model: 'gemini-3.1-flash-lite'
      },
      formatTeam
    );
    expect(value).toContain('**Brazil 1-1 Argentina** - Draw');
  });

  it('should truncate long reasoning to fit the embed field', () => {
    const longReasoning = 'x'.repeat(500);
    const value = msgs.formatAiPredictionField(
      { home: 'Brazil', away: 'Argentina' },
      {
        homeScore: 2,
        awayScore: 1,
        resultPick: 'home',
        reasoning: longReasoning,
        model: 'gemini-3.1-flash-lite'
      },
      formatTeam
    );
    expect(value.length).toBeLessThanOrEqual(msgs.AI_FIELD_MAX_LENGTH);
    expect(value).toContain('Brazil 2-1 Argentina');
  });
});
