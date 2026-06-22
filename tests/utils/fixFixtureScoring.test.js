const {
  parseScoreArg,
  computeScoringCorrection,
  planFixtureScoringCorrections
} = require('../../utils/fixFixtureScoring');

describe('fixFixtureScoring', () => {
  describe('parseScoreArg', () => {
    it('should parse score strings', () => {
      expect(parseScoreArg('5-1')).toEqual({ home: 5, away: 1 });
      expect(parseScoreArg('4 - 1')).toEqual({ home: 4, away: 1 });
    });

    it('should reject invalid score strings', () => {
      expect(() => parseScoreArg('five-one')).toThrow(/Invalid score/);
    });
  });

  describe('computeScoringCorrection for match 537371 (5-1 vs 4-1)', () => {
    const wrongActual = { home: 5, away: 1 };
    const correctActual = { home: 4, away: 1 };

    it('should remove exact-score points from users who picked 5-1', () => {
      const correction = computeScoringCorrection(
        { homeScore: 5, awayScore: 1, resultPick: 'home' },
        wrongActual,
        correctActual
      );
      expect(correction.oldTotal).toBe(3);
      expect(correction.newTotal).toBe(1);
      expect(correction.delta).toBe(-2);
    });

    it('should award exact-score points to users who picked 4-1', () => {
      const correction = computeScoringCorrection(
        { homeScore: 4, awayScore: 1, resultPick: 'home' },
        wrongActual,
        correctActual
      );
      expect(correction.oldTotal).toBe(1);
      expect(correction.newTotal).toBe(3);
      expect(correction.delta).toBe(2);
    });

    it('should leave other home-win picks unchanged', () => {
      const correction = computeScoringCorrection(
        { homeScore: 3, awayScore: 0, resultPick: 'home' },
        wrongActual,
        correctActual
      );
      expect(correction.oldTotal).toBe(1);
      expect(correction.newTotal).toBe(1);
      expect(correction.delta).toBe(0);
    });
  });

  describe('planFixtureScoringCorrections', () => {
    it('should only include users whose totals change', () => {
      const plan = planFixtureScoringCorrections({
        fixtureId: 537371,
        wrongActual: { home: 5, away: 1 },
        correctActual: { home: 4, away: 1 },
        loadPredictions: () => [
          {
            userId: '111',
            prediction: {
              homeScore: 5,
              awayScore: 1,
              resultPick: 'home',
              scored: true,
              scorePoints: 2,
              resultPoints: 1,
              pointsAwarded: 3
            }
          },
          {
            userId: '222',
            prediction: {
              homeScore: 2,
              awayScore: 0,
              resultPick: 'home',
              scored: true,
              scorePoints: 0,
              resultPoints: 1,
              pointsAwarded: 1
            }
          },
          {
            userId: '333',
            prediction: {
              homeScore: 4,
              awayScore: 1,
              resultPick: 'home',
              scored: true,
              scorePoints: 0,
              resultPoints: 1,
              pointsAwarded: 1
            }
          }
        ]
      });

      expect(plan).toHaveLength(2);
      expect(plan.map(entry => entry.userId).sort()).toEqual(['111', '333']);
      expect(plan.find(entry => entry.userId === '111')?.correction.delta).toBe(-2);
      expect(plan.find(entry => entry.userId === '333')?.correction.delta).toBe(2);
    });
  });
});
