const dayjs = require('dayjs');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

describe('predictionScoreRepostCommand', () => {
  let repostCommand;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();
    mockLogger = { info: jest.fn(), error: jest.fn() };
    repostCommand = require('../../utils/predictionScoreRepostCommand');
  });

  describe('getFinishedScoredFixtures', () => {
    it('should filter to finished scored fixtures sorted by kickoff descending', async () => {
      const getSeasonFixtures = jest.fn().mockResolvedValue([
        {
          id: 1,
          status: 'FT',
          goals: { home: 1, away: 0 },
          kickoff: dayjs().subtract(2, 'day').toISOString()
        },
        {
          id: 2,
          status: 'FT',
          goals: { home: 2, away: 1 },
          kickoff: dayjs().subtract(1, 'day').toISOString()
        },
        {
          id: 3,
          status: 'NS',
          goals: { home: null, away: null },
          kickoff: dayjs().subtract(1, 'day').toISOString()
        },
        {
          id: 4,
          status: 'FT',
          goals: { home: 0, away: 0 },
          kickoff: dayjs().subtract(3, 'day').toISOString()
        },
        {
          id: 5,
          status: 'FT',
          goals: { home: 1, away: 1 },
          kickoff: dayjs().subtract(1, 'day').toISOString()
        }
      ]);
      const getScoredFixtures = jest.fn().mockResolvedValue([1, 2, 4]);

      const fixtures = await repostCommand.getFinishedScoredFixtures(
        getSeasonFixtures,
        getScoredFixtures
      );

      expect(fixtures.map(f => f.id)).toEqual([2, 1, 4]);
    });

    it('should pass competition filter to getSeasonFixtures', async () => {
      const getSeasonFixtures = jest.fn().mockResolvedValue([]);
      const getScoredFixtures = jest.fn().mockResolvedValue([]);
      await repostCommand.getFinishedScoredFixtures(getSeasonFixtures, getScoredFixtures, {
        competition: 'PL'
      });
      expect(getSeasonFixtures).toHaveBeenCalledWith({ competition: 'PL' });
    });
  });

  describe('handleRepostScoreSubcommand', () => {
    const baseDeps = {
      gameId: 'club',
      selectCustomId: 'football:repostscore:select',
      isApiConfigured: () => true,
      isGameConfigured: () => true,
      getSeasonFixtures: jest.fn(),
      getScoredFixtures: jest.fn().mockResolvedValue([]),
      formatFixtureLine: jest.fn().mockReturnValue('A vs B')
    };

    it('should require a guild', async () => {
      const interaction = createMockInteraction({
        guild: null,
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await repostCommand.handleRepostScoreSubcommand(interaction, baseDeps);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should deny non-administrators', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: { has: jest.fn().mockReturnValue(false) }
      });
      await repostCommand.handleRepostScoreSubcommand(interaction, baseDeps);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should reject when API is not configured', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await repostCommand.handleRepostScoreSubcommand(interaction, {
        ...baseDeps,
        isApiConfigured: () => false
      });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should reject when game is not configured', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await repostCommand.handleRepostScoreSubcommand(interaction, {
        ...baseDeps,
        isGameConfigured: () => false
      });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should show select menu for scored finished fixtures', async () => {
      baseDeps.getSeasonFixtures.mockResolvedValue([
        {
          id: 42,
          status: 'FT',
          goals: { home: 1, away: 0 },
          kickoff: dayjs().subtract(1, 'day').toISOString()
        }
      ]);
      baseDeps.getScoredFixtures.mockResolvedValue([42]);

      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await repostCommand.handleRepostScoreSubcommand(interaction, baseDeps);
      expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ components: expect.any(Array) })
      );
    });

    it('should pass competition filter when provided', async () => {
      const getSeasonFixtures = jest.fn().mockResolvedValue([
        {
          id: 1,
          status: 'FT',
          goals: { home: 1, away: 0 },
          kickoff: dayjs().subtract(1, 'day').toISOString()
        }
      ]);
      const getScoredFixtures = jest.fn().mockResolvedValue([1]);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await repostCommand.handleRepostScoreSubcommand(interaction, {
        ...baseDeps,
        getSeasonFixtures,
        getScoredFixtures,
        competition: 'PL'
      });
      expect(getSeasonFixtures).toHaveBeenCalledWith({ competition: 'PL' });
    });

    it('should report when no scored finished matches exist', async () => {
      baseDeps.getSeasonFixtures.mockResolvedValue([]);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await repostCommand.handleRepostScoreSubcommand(interaction, baseDeps);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('No scored finished') })
      );
    });
  });

  describe('handleRepostScoreSelect', () => {
    const finishedFixture = {
      id: 42,
      status: 'FT',
      goals: { home: 2, away: 1 },
      home: 'A',
      away: 'B'
    };

    let baseDeps;

    beforeEach(() => {
      baseDeps = {
        gameId: 'worldcup',
        isApiConfigured: () => true,
        isGameConfigured: () => true,
        getFixtureById: jest.fn().mockResolvedValue(finishedFixture),
        getScoredFixtures: jest.fn().mockResolvedValue([42]),
        formatFixtureLine: jest.fn().mockReturnValue('A vs B'),
        repostFinalScore: jest.fn().mockResolvedValue(true),
        logger: mockLogger
      };
    });

    it('should require a guild for select handling', async () => {
      const interaction = createMockInteraction({
        guild: null,
        values: ['42'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await repostCommand.handleRepostScoreSelect(interaction, baseDeps);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should deny non-administrators for select handling', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['42'],
        memberPermissions: { has: jest.fn().mockReturnValue(false) }
      });
      await repostCommand.handleRepostScoreSelect(interaction, baseDeps);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should reject select when API or game is not configured', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['42'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        }
      });
      await repostCommand.handleRepostScoreSelect(interaction, {
        ...baseDeps,
        isGameConfigured: () => false
      });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral })
      );
    });

    it('should reject invalid fixture ids', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['not-a-number'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await repostCommand.handleRepostScoreSelect(interaction, baseDeps);
      expect(baseDeps.repostFinalScore).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('invalid') })
      );
    });

    it('should report when fixture cannot be loaded', async () => {
      baseDeps.getFixtureById.mockResolvedValue(null);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['42'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await repostCommand.handleRepostScoreSelect(interaction, baseDeps);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('load') })
      );
    });

    it('should reject fixtures that are not finished', async () => {
      baseDeps.getFixtureById.mockResolvedValue({
        id: 42,
        status: 'NS',
        goals: { home: null, away: null }
      });
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['42'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await repostCommand.handleRepostScoreSelect(interaction, baseDeps);
      expect(baseDeps.repostFinalScore).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('not finished') })
      );
    });

    it('should reject unscored fixtures', async () => {
      baseDeps.getScoredFixtures.mockResolvedValue([]);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['42'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await repostCommand.handleRepostScoreSelect(interaction, baseDeps);
      expect(baseDeps.repostFinalScore).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('not been scored') })
      );
    });

    it('should repost selected fixture for administrators', async () => {
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['42'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await repostCommand.handleRepostScoreSelect(interaction, baseDeps);
      expect(baseDeps.repostFinalScore).toHaveBeenCalledWith(
        interaction.client,
        finishedFixture
      );
      expect(mockLogger.info).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Final score') })
      );
    });

    it('should report failure when repost does not post', async () => {
      baseDeps.repostFinalScore.mockResolvedValue(false);
      const interaction = createMockInteraction({
        guild: { id: 'g1' },
        values: ['42'],
        memberPermissions: {
          has: jest.fn(p => p === PermissionFlagsBits.Administrator)
        },
        client: { id: 'bot' },
        deferUpdate: jest.fn().mockResolvedValue({})
      });
      await repostCommand.handleRepostScoreSelect(interaction, baseDeps);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Could not post') })
      );
    });
  });
});
