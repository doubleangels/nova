const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');
const { createPredictionStore } = require('../../utils/predictionGameStore');
const { getWritableDb } = require('../../utils/sqliteStore');
const {
  REPORT_ATTACHMENT_THRESHOLD,
  summarizeReports,
  buildReportAttachment,
  runFixtureScoringFix,
  handleFixScoringSubcommand
} = require('../../utils/predictionFixScoringCommand');

const USER_A = '123456789012345678';
const FIXTURE_ID = 537371;
const WRONG = '5-1';
const CORRECT = '4-1';

function createAdminInteraction(overrides = {}) {
  return createMockInteraction({
    guild: { id: 'guild-1' },
    user: { id: 'admin-1' },
    memberPermissions: {
      has: jest.fn(p => p === PermissionFlagsBits.Administrator)
    },
    options: {
      getInteger: jest.fn(name => (name === 'fixture' ? FIXTURE_ID : null)),
      getString: jest.fn(name => {
        if (name === 'wrong') return WRONG;
        if (name === 'correct') return CORRECT;
        if (name === 'namespace') return null;
        return null;
      }),
      ...overrides.options
    },
    ...overrides
  });
}

describe('predictionFixScoringCommand', () => {
  let store;
  let db;

  beforeEach(async () => {
    store = createPredictionStore('football', 'Football');
    await store.resetGame();
    db = getWritableDb();
  });

  describe('summarizeReports', () => {
    it('should summarize changes and net delta', () => {
      const summary = summarizeReports([
        {
          changes: [{ delta: 2 }, { delta: -1 }],
          committed: false
        },
        {
          changes: [{ delta: 1 }],
          committed: true
        }
      ]);

      expect(summary).toEqual({
        totalChanges: 3,
        netDelta: 2,
        anyCommitted: true
      });
    });
  });

  describe('buildReportAttachment', () => {
    it('should return null for short reports', () => {
      expect(buildReportAttachment(1, 'short report')).toBeNull();
    });

    it('should attach a text file for long reports', () => {
      const longReport = 'x'.repeat(REPORT_ATTACHMENT_THRESHOLD + 1);
      const attachment = buildReportAttachment(FIXTURE_ID, longReport);
      expect(attachment).not.toBeNull();
      expect(attachment.name).toBe(`fixture-${FIXTURE_ID}-scoring-fix.txt`);
    });
  });

  describe('runFixtureScoringFix', () => {
    it('should preview without writing when commit is false', async () => {
      await store.savePrediction(USER_A, FIXTURE_ID, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });
      await store.addUserPoints(USER_A, 1);

      const result = runFixtureScoringFix({
        fixtureId: FIXTURE_ID,
        wrong: WRONG,
        correct: CORRECT,
        namespace: 'football',
        commit: false,
        db
      });

      expect(result.summary.totalChanges).toBe(1);
      expect(result.summary.anyCommitted).toBe(false);
      expect(await store.getUserPoints(USER_A)).toBe(1);
    });

    it('should commit scoring corrections by default', async () => {
      await store.savePrediction(USER_A, FIXTURE_ID, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });
      await store.addUserPoints(USER_A, 1);

      const result = runFixtureScoringFix({
        fixtureId: FIXTURE_ID,
        wrong: WRONG,
        correct: CORRECT,
        namespace: 'football',
        db
      });

      expect(result.summary.totalChanges).toBe(1);
      expect(result.summary.anyCommitted).toBe(true);
      expect(await store.getUserPoints(USER_A)).toBe(3);
    });

    it('should report no changes for unchanged picks', async () => {
      await store.savePrediction(USER_A, FIXTURE_ID, {
        homeScore: 3,
        awayScore: 1,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });
      await store.addUserPoints(USER_A, 1);

      const result = runFixtureScoringFix({
        fixtureId: FIXTURE_ID,
        wrong: WRONG,
        correct: CORRECT,
        namespace: 'football',
        db
      });

      expect(result.summary.totalChanges).toBe(0);
      expect(result.fullReport).toContain('No point adjustments needed.');
      expect(await store.getUserPoints(USER_A)).toBe(1);
    });

    it('should include a namespace warning when the requested namespace has no data', async () => {
      setKey(db, `worldcup:prediction:${USER_A}:${FIXTURE_ID}`, {
        homeScore: 3,
        awayScore: 1,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });

      const result = runFixtureScoringFix({
        fixtureId: FIXTURE_ID,
        wrong: WRONG,
        correct: CORRECT,
        namespace: 'football',
        commit: false,
        db
      });

      expect(result.namespaceWarning).toContain('worldcup');
      expect(result.fullReport).toContain('Warning:');
    });
  });

  describe('handleFixScoringSubcommand', () => {
    it('should require a guild', async () => {
      const interaction = createAdminInteraction({ guild: null });
      await handleFixScoringSubcommand(interaction, {
        gameId: 'worldcup',
        isApiConfigured: jest.fn().mockReturnValue(true),
        getWritableDb: () => db,
        logger: { info: jest.fn() }
      });

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('server')
      }));
    });

    it('should deny non-administrators', async () => {
      const interaction = createAdminInteraction({
        memberPermissions: { has: jest.fn().mockReturnValue(false) }
      });
      await handleFixScoringSubcommand(interaction, {
        gameId: 'club',
        isApiConfigured: jest.fn().mockReturnValue(true),
        getWritableDb: () => db,
        logger: { info: jest.fn() }
      });

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('administrators')
      }));
    });

    it('should reject when API is not configured', async () => {
      const interaction = createAdminInteraction();
      await handleFixScoringSubcommand(interaction, {
        gameId: 'worldcup',
        isApiConfigured: jest.fn().mockReturnValue(false),
        getWritableDb: () => db,
        logger: { info: jest.fn() }
      });

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('not set up')
      }));
    });

    it('should reject invalid score formats', async () => {
      const interaction = createAdminInteraction({
        options: {
          getInteger: jest.fn().mockReturnValue(FIXTURE_ID),
          getString: jest.fn(name => (name === 'wrong' ? 'bad' : CORRECT))
        }
      });

      await handleFixScoringSubcommand(interaction, {
        gameId: 'worldcup',
        isApiConfigured: jest.fn().mockReturnValue(true),
        getWritableDb: () => db,
        logger: { info: jest.fn() }
      });

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Invalid score')
      }));
    });

    it('should apply fixes and reply with a summary embed', async () => {
      const interaction = createAdminInteraction();
      const logger = { info: jest.fn() };

      await handleFixScoringSubcommand(interaction, {
        gameId: 'worldcup',
        isApiConfigured: jest.fn().mockReturnValue(true),
        getWritableDb: () => db,
        logger
      });

      expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({ title: 'Fix Fixture Scoring' })
          })
        ]),
        content: '_No database changes were written._'
      }));
      expect(logger.info).toHaveBeenCalled();
    });

    it('should attach a file when the report is very long', async () => {
      const longReport = 'x'.repeat(REPORT_ATTACHMENT_THRESHOLD + 1);
      let isolatedHandler;

      jest.isolateModules(() => {
        jest.doMock('../../utils/fixFixtureScoring', () => {
          const actual = jest.requireActual('../../utils/fixFixtureScoring');
          return {
            ...actual,
            formatMultiNamespaceFixtureScoringReport: jest.fn(() => longReport)
          };
        });
        ({ handleFixScoringSubcommand: isolatedHandler } = require('../../utils/predictionFixScoringCommand'));
      });

      const interaction = createAdminInteraction();
      await isolatedHandler(interaction, {
        gameId: 'worldcup',
        isApiConfigured: jest.fn().mockReturnValue(true),
        getWritableDb: () => db,
        logger: { info: jest.fn() }
      });

      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({
            name: `fixture-${FIXTURE_ID}-scoring-fix.txt`
          })
        ])
      }));
    });

    it('should report committed changes', async () => {
      await store.savePrediction(USER_A, FIXTURE_ID, {
        homeScore: 4,
        awayScore: 1,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });
      await store.addUserPoints(USER_A, 1);

      const interaction = createAdminInteraction({
        options: {
          getInteger: jest.fn().mockReturnValue(FIXTURE_ID),
          getString: jest.fn(name => {
            if (name === 'wrong') return WRONG;
            if (name === 'correct') return CORRECT;
            return null;
          })
        }
      });

      await handleFixScoringSubcommand(interaction, {
        gameId: 'worldcup',
        isApiConfigured: jest.fn().mockReturnValue(true),
        getWritableDb: () => db,
        logger: { info: jest.fn() }
      });

      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({ title: 'Fixture Scoring Changes Applied' })
          })
        ])
      }));
      expect(await store.getUserPoints(USER_A)).toBe(3);
    });
  });
});

/**
 * @param {import('better-sqlite3').Database} database
 * @param {string} key
 * @param {unknown} value
 */
function setKey(database, key, value) {
  database.prepare(`
    INSERT INTO keyv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify({ value, expires: null }));
}
