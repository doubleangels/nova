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
  });

  it('should format my pick lines', () => {
    expect(msgs.formatMyPickLine(2, 1, 'Home', true, 4)).toContain('+4');
    expect(msgs.formatMyPickLine(0, 0, 'Draw', false)).toContain('awaiting final score');
  });

  it('should build register embed copy', () => {
    expect(msgs.buildRegisterSuccessDescription('<#1>', 'Predictor')).toContain(
      'World Cup'
    );
    expect(msgs.buildRegisterAlreadyDescription()).toContain('already registered');
  });
});
