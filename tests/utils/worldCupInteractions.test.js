const { MessageFlags } = require('discord.js');

describe('worldCupInteractions', () => {
  let interactions;
  let mockUtils;
  let mockClient;

  beforeEach(() => {
    jest.resetModules();

    const actualUtils = jest.requireActual('../../utils/worldCupUtils');
    const savePendingPrediction = jest.fn().mockImplementation(async (_userId, _fixtureId, partial) => ({
      ...partial,
      updatedAt: new Date().toISOString()
    }));

    mockUtils = {
      isUserRegistered: jest.fn().mockResolvedValue(true),
      getPrediction: jest.fn().mockResolvedValue(null),
      savePrediction: jest.fn().mockResolvedValue(),
      isFixtureOpenForPrediction: jest.fn().mockReturnValue(true),
      truncateModalLabel: actualUtils.truncateModalLabel,
      formatFixtureTeam: actualUtils.formatFixtureTeam,
      formatResultPickDisplay: actualUtils.formatResultPickDisplay,
      isPendingPredictionComplete: actualUtils.isPendingPredictionComplete,
      savePendingPrediction,
      getPendingPrediction: jest.fn().mockResolvedValue(null),
      clearPendingPrediction: jest.fn().mockResolvedValue(),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0),
      areAllMockPlayableFixturesPredicted: jest.fn().mockResolvedValue(true),
      store: {}
    };
    mockUtils.store.isUserRegistered = mockUtils.isUserRegistered;
    mockUtils.store.getPrediction = mockUtils.getPrediction;
    mockUtils.store.savePrediction = mockUtils.savePrediction;
    mockUtils.store.savePendingPrediction = mockUtils.savePendingPrediction;
    mockUtils.store.getPendingPrediction = mockUtils.getPendingPrediction;
    mockUtils.store.clearPendingPrediction = mockUtils.clearPendingPrediction;
    mockUtils.store.areAllMockPlayableFixturesPredicted =
      mockUtils.areAllMockPlayableFixturesPredicted;

    mockClient = {
      getFixtureById: jest.fn().mockResolvedValue({
        id: 42,
        home: 'Brazil',
        away: 'Argentina',
        kickoff: '2026-06-12T18:00:00+00:00',
        status: 'NS',
        goals: { home: null, away: null }
      })
    };

    jest.doMock('../../utils/worldCupUtils', () => mockUtils);
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(true),
      getFixtureById: (...args) => mockClient.getFixtureById(...args)
    }));
    jest.doMock('../../config', () => ({
      baseEmbedColor: 0x123456,
      worldCupParticipantRoleId: '333333333333333333',
      predictionMockApi: false
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn()
    }));

    interactions = require('../../utils/worldCupInteractions');
  });

  it('should show three dropdowns on button click', async () => {
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      guild: { id: 'guild-1' },
      member: {
        roles: { cache: { has: jest.fn().mockReturnValue(true) } }
      },
      reply: jest.fn().mockResolvedValue()
    };

    await interactions.handleWorldCupPredictButton(interaction);

    expect(mockUtils.clearPendingPrediction).toHaveBeenCalledWith(
      '111111111111111111',
      42
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.arrayContaining([
          expect.objectContaining({ components: expect.any(Array) })
        ]),
        flags: MessageFlags.Ephemeral
      })
    );
    const rows = interaction.reply.mock.calls[0][0].components;
    expect(rows).toHaveLength(3);
  });

  it('should reject unregistered users without role', async () => {
    mockUtils.isUserRegistered.mockResolvedValue(false);

    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      guild: { id: 'guild-1' },
      member: {
        roles: { cache: { has: jest.fn().mockReturnValue(false) } }
      },
      reply: jest.fn()
    };

    await interactions.handleWorldCupPredictButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral
    }));
  });

  it('should update form after partial picks', async () => {
    mockUtils.savePendingPrediction.mockResolvedValue({
      homeScore: 2,
      awayScore: 1,
      updatedAt: new Date().toISOString()
    });

    const interaction = {
      customId: 'worldcup:pick:home:42',
      user: { id: '111111111111111111' },
      values: ['2'],
      update: jest.fn().mockResolvedValue()
    };

    await interactions.handleWorldCupPickSelect(interaction);

    expect(mockUtils.savePrediction).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.any(Array)
      })
    );
  });

  it('should save prediction when all three dropdowns are set', async () => {
    mockUtils.savePendingPrediction.mockResolvedValue({
      homeScore: 2,
      awayScore: 1,
      resultPick: 'home',
      updatedAt: new Date().toISOString()
    });

    const interaction = {
      customId: 'worldcup:pick:winner:42',
      user: { id: '111111111111111111' },
      values: ['home'],
      client: {},
      update: jest.fn().mockResolvedValue()
    };

    await interactions.handleWorldCupPickSelect(interaction);

    expect(mockUtils.savePrediction).toHaveBeenCalledWith(
      '111111111111111111',
      42,
      expect.objectContaining({
        homeScore: 2,
        awayScore: 1,
        resultPick: 'home'
      })
    );
    expect(mockUtils.clearPendingPrediction).toHaveBeenCalledWith(
      '111111111111111111',
      42
    );
    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: []
      })
    );
  });

  it('should build three select rows with team labels', () => {
    const rows = interactions.buildPredictionSelectRows(
      { home: 'Brazil', away: 'Argentina' },
      42,
      { homeScore: 2, awayScore: 0, resultPick: 'home' }
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].components[0].data.custom_id).toBe('worldcup:pick:home:42');
    expect(rows[2].components[0].options.map(o => o.data.label)).toEqual([
      '🇧🇷 Brazil',
      'Draw',
      '🇦🇷 Argentina'
    ]);
  });

  it('should parse pick custom ids', () => {
    expect(interactions.parsePickCustomId('worldcup:pick:away:99')).toEqual({
      side: 'away',
      fixtureId: 99
    });
    expect(interactions.isWorldCupPickSelect('worldcup:pick:winner:1')).toBe(true);
  });
});
