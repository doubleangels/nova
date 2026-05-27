const { MessageFlags } = require('discord.js');

describe('worldCupInteractions', () => {
  let interactions;
  let mockUtils;
  let mockClient;

  beforeEach(() => {
    jest.resetModules();

    const actualUtils = jest.requireActual('../../utils/worldCupUtils');
    mockUtils = {
      isUserRegistered: jest.fn().mockResolvedValue(true),
      getPrediction: jest.fn().mockResolvedValue(null),
      savePrediction: jest.fn().mockResolvedValue(),
      isFixtureOpenForPrediction: jest.fn().mockReturnValue(true),
      parseResultPick: actualUtils.parseResultPick,
      parseScoreInputs: actualUtils.parseScoreInputs
    };

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
      worldCupParticipantRoleId: '333333333333333333'
    }));
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn()
    }));

    interactions = require('../../utils/worldCupInteractions');
  });

  it('should show modal on button click', async () => {
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      guild: { id: 'guild-1' },
      member: {
        roles: { cache: { has: jest.fn().mockReturnValue(true) } }
      },
      reply: jest.fn(),
      showModal: jest.fn().mockResolvedValue()
    };

    await interactions.handleWorldCupPredictButton(interaction);

    expect(interaction.showModal).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
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
      reply: jest.fn(),
      showModal: jest.fn()
    };

    await interactions.handleWorldCupPredictButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral
    }));
  });

  it('should require guild for button', async () => {
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '1' },
      guild: null,
      reply: jest.fn()
    };
    await interactions.handleWorldCupPredictButton(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reject when fixture not found', async () => {
    mockClient.getFixtureById.mockResolvedValue(null);
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      guild: { id: 'g' },
      member: { roles: { cache: { has: jest.fn().mockReturnValue(true) } } },
      reply: jest.fn()
    };
    await interactions.handleWorldCupPredictButton(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reject invalid fixture id on button', async () => {
    const interaction = {
      customId: 'worldcup:predict:notanumber',
      user: { id: '1' },
      guild: { id: 'g' },
      member: { roles: { cache: { has: jest.fn().mockReturnValue(true) } } },
      reply: jest.fn()
    };
    await interactions.handleWorldCupPredictButton(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ Invalid match reference.'
    }));
  });

  it('should reject when fixture closed', async () => {
    mockUtils.isFixtureOpenForPrediction.mockReturnValue(false);
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      guild: { id: 'g' },
      member: { roles: { cache: { has: jest.fn().mockReturnValue(true) } } },
      reply: jest.fn(),
      showModal: jest.fn()
    };
    await interactions.handleWorldCupPredictButton(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reject duplicate prediction on button', async () => {
    mockUtils.getPrediction.mockResolvedValue({ homeScore: 1, awayScore: 0 });
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      guild: { id: 'g' },
      member: { roles: { cache: { has: jest.fn().mockReturnValue(true) } } },
      reply: jest.fn(),
      showModal: jest.fn()
    };
    await interactions.handleWorldCupPredictButton(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should save prediction on modal submit', async () => {
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      fields: {
        getTextInputValue: jest.fn((id) => {
          if (id === 'home_score') return '2';
          if (id === 'away_score') return '1';
          if (id === 'result_pick') return 'home';
          return '';
        })
      },
      reply: jest.fn().mockResolvedValue()
    };

    await interactions.handleWorldCupPredictModal(interaction);

    expect(mockUtils.savePrediction).toHaveBeenCalledWith(
      '111111111111111111',
      42,
      expect.objectContaining({
        homeScore: 2,
        awayScore: 1,
        resultPick: 'home'
      })
    );
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reject invalid fixture id on modal', async () => {
    const interaction = {
      customId: 'worldcup:predict:bad',
      user: { id: '1' },
      fields: { getTextInputValue: jest.fn() },
      reply: jest.fn()
    };
    await interactions.handleWorldCupPredictModal(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reject closed fixture on modal', async () => {
    mockUtils.isFixtureOpenForPrediction.mockReturnValue(false);
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      fields: {
        getTextInputValue: jest.fn((id) => {
          if (id === 'home_score') return '1';
          if (id === 'away_score') return '0';
          return 'home';
        })
      },
      reply: jest.fn()
    };
    await interactions.handleWorldCupPredictModal(interaction);
    expect(mockUtils.savePrediction).not.toHaveBeenCalled();
  });

  it('should reject duplicate on modal', async () => {
    mockUtils.getPrediction.mockResolvedValue({ homeScore: 1, awayScore: 0 });
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      fields: {
        getTextInputValue: jest.fn((id) => {
          if (id === 'home_score') return '1';
          if (id === 'away_score') return '0';
          return 'home';
        })
      },
      reply: jest.fn()
    };
    await interactions.handleWorldCupPredictModal(interaction);
    expect(mockUtils.savePrediction).not.toHaveBeenCalled();
  });

  it('should reject invalid modal scores', async () => {
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      fields: {
        getTextInputValue: jest.fn(() => 'bad')
      },
      reply: jest.fn()
    };
    await interactions.handleWorldCupPredictModal(interaction);
    expect(mockUtils.savePrediction).not.toHaveBeenCalled();
  });

  it('should reject when API not configured', async () => {
    jest.resetModules();
    jest.doMock('../../utils/worldCupClient', () => ({
      isApiConfigured: jest.fn().mockReturnValue(false),
      getFixtureById: jest.fn()
    }));
    jest.doMock('../../utils/worldCupUtils', () => mockUtils);
    jest.doMock('../../config', () => ({}));
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    const ix = require('../../utils/worldCupInteractions');
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '1' },
      reply: jest.fn()
    };
    await ix.handleWorldCupPredictButton(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reject invalid result pick on modal', async () => {
    const interaction = {
      customId: 'worldcup:predict:42',
      user: { id: '111111111111111111' },
      fields: {
        getTextInputValue: jest.fn((id) => {
          if (id === 'home_score') return '1';
          if (id === 'away_score') return '0';
          return 'invalid';
        })
      },
      reply: jest.fn()
    };
    await interactions.handleWorldCupPredictModal(interaction);
    expect(mockUtils.savePrediction).not.toHaveBeenCalled();
  });
});
