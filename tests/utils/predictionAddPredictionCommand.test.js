const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');
const { createPredictionStore } = require('../../utils/predictionGameStore');
const {
  addPredictionForUser,
  handleAddPredictionSubcommand
} = require('../../utils/predictionAddPredictionCommand');
const { scoreFixtureIfFinished } = require('../../utils/predictionGameScoring');

const USER_ID = '123456789012345678';
const FIXTURE_ID = 537371;

const openFixture = {
  id: FIXTURE_ID,
  status: 'NS',
  kickoff: '2099-06-01T18:00:00.000Z',
  home: 'Team A',
  away: 'Team B',
  goals: { home: null, away: null }
};

const finishedFixture = {
  id: FIXTURE_ID,
  status: 'FT',
  home: 'Team A',
  away: 'Team B',
  goals: { home: 4, away: 1 }
};

function createAdminInteraction(overrides = {}) {
  return createMockInteraction({
    guild: { id: 'guild-1' },
    user: { id: 'admin-1' },
    memberPermissions: {
      has: jest.fn(p => p === PermissionFlagsBits.Administrator)
    },
    options: {
      getUser: jest.fn().mockReturnValue({ id: USER_ID, bot: false }),
      getInteger: jest.fn(name => {
        if (name === 'fixture') return FIXTURE_ID;
        if (name === 'home') return 4;
        if (name === 'away') return 1;
        return null;
      }),
      getString: jest.fn().mockReturnValue(null),
      ...overrides.options
    },
    ...overrides
  });
}

function baseDeps(store, overrides = {}) {
  return {
    gameId: 'worldcup',
    isApiConfigured: jest.fn().mockReturnValue(true),
    store,
    getFixtureById: jest.fn().mockResolvedValue(finishedFixture),
    getScoredFixtures: jest.fn().mockResolvedValue([]),
    scoreFixtureIfFinished: jest.fn(fixture => scoreFixtureIfFinished(store, fixture)),
    applyUserScoringUpdate: jest.fn((fixtureId, userId, prediction, pointsDelta) =>
      store.applyUserScoringUpdate(fixtureId, userId, prediction, pointsDelta)
    ),
    formatFixtureLine: jest.fn(() => 'Team A vs Team B'),
    formatResultPickDisplay: jest.fn(() => 'Home'),
    parseScoreInputs: jest.fn(() => ({ homeScore: 4, awayScore: 1 })),
    logger: { info: jest.fn() },
    ...overrides
  };
}

describe('predictionAddPredictionCommand', () => {
  let store;

  beforeEach(async () => {
    jest.resetModules();
    store = createPredictionStore('add-prediction-test', 'AddPrediction');
    await store.resetGame();
  });

  describe('addPredictionForUser', () => {
    it('should return not found when fixture is missing', async () => {
      const result = await addPredictionForUser({
        store,
        getFixtureById: jest.fn().mockResolvedValue(null),
        getScoredFixtures: jest.fn().mockResolvedValue([]),
        scoreFixtureIfFinished: jest.fn(),
        applyUserScoringUpdate: jest.fn(),
        userId: USER_ID,
        fixtureId: FIXTURE_ID,
        homeScore: 2,
        awayScore: 1
      });

      expect(result).toEqual({ ok: false, error: 'ERR_FIXTURE_NOT_FOUND' });
    });

    it('should save an unscored prediction for an open match', async () => {
      const result = await addPredictionForUser({
        store,
        getFixtureById: jest.fn().mockResolvedValue(openFixture),
        getScoredFixtures: jest.fn().mockResolvedValue([]),
        scoreFixtureIfFinished: jest.fn(),
        applyUserScoringUpdate: jest.fn(),
        userId: USER_ID,
        fixtureId: FIXTURE_ID,
        homeScore: 2,
        awayScore: 0
      });

      expect(result.ok).toBe(true);
      expect(result.scoredNow).toBe(false);
      expect(result.pointsDelta).toBe(0);

      const saved = await store.getPrediction(USER_ID, FIXTURE_ID);
      expect(saved).toMatchObject({
        homeScore: 2,
        awayScore: 0,
        resultPick: 'home',
        scored: false
      });
    });

    it('should score immediately when the fixture is finished but not yet marked scored', async () => {
      const result = await addPredictionForUser({
        store,
        getFixtureById: jest.fn().mockResolvedValue(finishedFixture),
        getScoredFixtures: jest.fn().mockResolvedValue([]),
        scoreFixtureIfFinished: fixture => scoreFixtureIfFinished(store, fixture),
        applyUserScoringUpdate: jest.fn(),
        userId: USER_ID,
        fixtureId: FIXTURE_ID,
        homeScore: 4,
        awayScore: 1
      });

      expect(result.ok).toBe(true);
      expect(result.scoredNow).toBe(true);
      expect(result.matchPoints).toBe(3);
      expect(result.pointsDelta).toBe(3);
      expect(await store.getUserPoints(USER_ID)).toBe(3);
      expect(await store.getScoredFixtures()).toContain(FIXTURE_ID);
    });

    it('should score a late prediction on an already-scored fixture', async () => {
      await store.markFixtureScored(FIXTURE_ID);

      const result = await addPredictionForUser({
        store,
        getFixtureById: jest.fn().mockResolvedValue(finishedFixture),
        getScoredFixtures: () => store.getScoredFixtures(),
        scoreFixtureIfFinished: jest.fn(),
        applyUserScoringUpdate: (fixtureId, userId, prediction, pointsDelta) =>
          store.applyUserScoringUpdate(fixtureId, userId, prediction, pointsDelta),
        userId: USER_ID,
        fixtureId: FIXTURE_ID,
        homeScore: 4,
        awayScore: 1
      });

      expect(result.ok).toBe(true);
      expect(result.scoredNow).toBe(true);
      expect(result.matchPoints).toBe(3);
      expect(result.pointsDelta).toBe(3);
      expect(await store.getUserPoints(USER_ID)).toBe(3);
    });

    it('should overwrite a scored prediction and apply a signed points delta', async () => {
      await store.savePrediction(USER_ID, FIXTURE_ID, {
        homeScore: 3,
        awayScore: 0,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        scorePoints: 0,
        resultPoints: 1,
        pointsAwarded: 1
      });
      await store.addUserPoints(USER_ID, 1);
      await store.markFixtureScored(FIXTURE_ID);

      const result = await addPredictionForUser({
        store,
        getFixtureById: jest.fn().mockResolvedValue(finishedFixture),
        getScoredFixtures: () => store.getScoredFixtures(),
        scoreFixtureIfFinished: jest.fn(),
        applyUserScoringUpdate: (fixtureId, userId, prediction, pointsDelta) =>
          store.applyUserScoringUpdate(fixtureId, userId, prediction, pointsDelta),
        userId: USER_ID,
        fixtureId: FIXTURE_ID,
        homeScore: 4,
        awayScore: 1
      });

      expect(result.overwritten).toBe(true);
      expect(result.pointsDelta).toBe(2);
      expect(await store.getUserPoints(USER_ID)).toBe(3);

      const saved = await store.getPrediction(USER_ID, FIXTURE_ID);
      expect(saved.pointsAwarded).toBe(3);
    });

    it('should treat missing pointsAwarded as zero when overwriting a scored prediction', async () => {
      await store.savePrediction(USER_ID, FIXTURE_ID, {
        homeScore: 3,
        awayScore: 0,
        resultPick: 'home',
        submittedAt: new Date().toISOString(),
        scored: true,
        scorePoints: 0,
        resultPoints: 1
      });
      await store.markFixtureScored(FIXTURE_ID);

      const result = await addPredictionForUser({
        store,
        getFixtureById: jest.fn().mockResolvedValue(finishedFixture),
        getScoredFixtures: () => store.getScoredFixtures(),
        scoreFixtureIfFinished: jest.fn(),
        applyUserScoringUpdate: (fixtureId, userId, prediction, pointsDelta) =>
          store.applyUserScoringUpdate(fixtureId, userId, prediction, pointsDelta),
        userId: USER_ID,
        fixtureId: FIXTURE_ID,
        homeScore: 4,
        awayScore: 1
      });

      expect(result.pointsDelta).toBe(3);
      expect(await store.getUserPoints(USER_ID)).toBe(3);
    });

    it('should return computed scoring when batch scoring leaves no stored prediction', async () => {
      const mockStore = {
        getPrediction: jest.fn().mockResolvedValue(null),
        savePrediction: jest.fn().mockResolvedValue(),
        getUserPoints: jest.fn().mockResolvedValue(0)
      };

      const result = await addPredictionForUser({
        store: mockStore,
        getFixtureById: jest.fn().mockResolvedValue(finishedFixture),
        getScoredFixtures: jest.fn().mockResolvedValue([]),
        scoreFixtureIfFinished: jest.fn().mockResolvedValue({ scored: true }),
        applyUserScoringUpdate: jest.fn(),
        userId: USER_ID,
        fixtureId: FIXTURE_ID,
        homeScore: 4,
        awayScore: 1
      });

      expect(result.prediction).toMatchObject({
        scored: true,
        pointsAwarded: 3
      });
      expect(result.pointsDelta).toBe(3);
    });
  });

  describe('handleAddPredictionSubcommand', () => {
    it('should require a guild', async () => {
      const interaction = createAdminInteraction({ guild: null });
      await handleAddPredictionSubcommand(interaction, baseDeps(store));

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('server')
      }));
    });

    it('should deny non-administrators', async () => {
      const interaction = createAdminInteraction({
        memberPermissions: { has: jest.fn().mockReturnValue(false) }
      });
      await handleAddPredictionSubcommand(interaction, baseDeps(store));

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('administrators')
      }));
    });

    it('should reject when API is not configured', async () => {
      const interaction = createAdminInteraction();
      await handleAddPredictionSubcommand(interaction, baseDeps(store, {
        isApiConfigured: jest.fn().mockReturnValue(false)
      }));

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('not set up')
      }));
    });

    it('should reject bot targets', async () => {
      const interaction = createAdminInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: 'bot-id', bot: true }),
          getInteger: jest.fn(name => {
            if (name === 'fixture') return FIXTURE_ID;
            if (name === 'home') return 1;
            if (name === 'away') return 0;
            return null;
          }),
          getString: jest.fn().mockReturnValue(null)
        }
      });

      await handleAddPredictionSubcommand(interaction, baseDeps(store));

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Bots cannot receive')
      }));
    });

    it('should reject unknown fixtures', async () => {
      const interaction = createAdminInteraction();
      await handleAddPredictionSubcommand(interaction, baseDeps(store, {
        getFixtureById: jest.fn().mockResolvedValue(null)
      }));

      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('not found')
      }));
    });

    it('should reject invalid score input', async () => {
      const interaction = createAdminInteraction();
      await handleAddPredictionSubcommand(interaction, baseDeps(store, {
        parseScoreInputs: jest.fn().mockReturnValue({ error: 'Goals must be 0 to 15.' })
      }));

      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Goals must be 0 to 15.')
      }));
    });

    it('should reject invalid winner values', async () => {
      const interaction = createAdminInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: USER_ID, bot: false }),
          getInteger: jest.fn(name => {
            if (name === 'fixture') return FIXTURE_ID;
            if (name === 'home') return 4;
            if (name === 'away') return 1;
            return null;
          }),
          getString: jest.fn().mockReturnValue('invalid')
        }
      });

      await handleAddPredictionSubcommand(interaction, baseDeps(store));

      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Invalid winner')
      }));
    });

    it('should add a prediction and reply with a success embed', async () => {
      const interaction = createAdminInteraction();
      const deps = baseDeps(store, {
        getFixtureById: jest.fn().mockResolvedValue(openFixture)
      });

      await handleAddPredictionSubcommand(interaction, deps);

      expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({ title: 'Prediction Added' })
          })
        ])
      }));
      expect(deps.logger.info).toHaveBeenCalled();
    });

    it('should accept an explicit result option', async () => {
      const interaction = createAdminInteraction({
        options: {
          getUser: jest.fn().mockReturnValue({ id: USER_ID, bot: false }),
          getInteger: jest.fn(name => {
            if (name === 'fixture') return FIXTURE_ID;
            if (name === 'home') return 1;
            if (name === 'away') return 1;
            return null;
          }),
          getString: jest.fn().mockReturnValue('draw')
        }
      });

      await handleAddPredictionSubcommand(interaction, baseDeps(store, {
        getFixtureById: jest.fn().mockResolvedValue(openFixture),
        parseScoreInputs: jest.fn().mockReturnValue({ homeScore: 1, awayScore: 1 })
      }));

      const saved = await store.getPrediction(USER_ID, FIXTURE_ID);
      expect(saved.resultPick).toBe('draw');
    });

    it('should report not found when the fixture disappears before saving', async () => {
      const interaction = createAdminInteraction();
      const getFixtureById = jest.fn()
        .mockResolvedValueOnce(openFixture)
        .mockResolvedValueOnce(null);

      await handleAddPredictionSubcommand(interaction, baseDeps(store, { getFixtureById }));

      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('not found')
      }));
    });
  });
});
