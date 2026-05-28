const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

describe('football command', () => {
  let footballCommand;
  let mockFootballUtils;
  let mockWorldCupUtils;
  let mockClientApi;
  let mockConfig;

  beforeEach(() => {
    jest.resetModules();

    mockFootballUtils = {
      isUserRegistered: jest.fn().mockResolvedValue(false),
      addRegisteredUser: jest.fn().mockResolvedValue()
    };

    mockWorldCupUtils = {
      isUserRegistered: jest.fn().mockResolvedValue(false),
      addRegisteredUser: jest.fn().mockResolvedValue()
    };

    mockClientApi = {
      isApiConfigured: jest.fn().mockReturnValue(true),
      getSeasonFixtures: jest.fn().mockResolvedValue([])
    };

    mockConfig = {
      baseEmbedColor: 0xABCDEF,
      predictionParticipantRoleId: '444444444444444444',
      predictionChannelId: '555555555555555555'
    };

    jest.doMock('../../utils/footballUtils', () => mockFootballUtils);
    jest.doMock('../../utils/worldCupUtils', () => mockWorldCupUtils);
    jest.doMock('../../utils/footballClient', () => mockClientApi);
    jest.doMock('../../utils/footballCompetitions', () => ({
      getCompetitionName: (code) => code
    }));
    jest.doMock('../../config', () => mockConfig);
    jest.doMock('../../logger', () => () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }));

    footballCommand = require('../../commands/football');
  });

  it('should register user for both games and assign role', async () => {
    const role = {
      id: '444444444444444444',
      name: 'Predictor',
      position: 1
    };
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('register')
      },
      guild: {
        id: 'guild-1',
        roles: {
          cache: new Map([[role.id, role]]),
          fetch: jest.fn()
        },
        members: {
          me: {
            permissions: { has: jest.fn().mockReturnValue(true) },
            roles: { highest: { position: 5 } }
          }
        }
      },
      member: {
        roles: {
          add: jest.fn().mockResolvedValue(),
          cache: { has: jest.fn() },
          highest: { position: 0 }
        }
      }
    });

    await footballCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.member.roles.add).toHaveBeenCalledWith(role, 'Prediction game registration');
    expect(mockFootballUtils.addRegisteredUser).toHaveBeenCalledWith('user-123');
    expect(mockWorldCupUtils.addRegisteredUser).toHaveBeenCalledWith('user-123');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('World Cup')
    }));
  });

  it('should report already registered when in both games', async () => {
    mockFootballUtils.isUserRegistered.mockResolvedValue(true);
    mockWorldCupUtils.isUserRegistered.mockResolvedValue(true);

    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: {
        id: 'guild-1',
        roles: { cache: new Map(), fetch: jest.fn() },
        members: {
          me: {
            permissions: { has: jest.fn().mockReturnValue(true) },
            roles: { highest: { position: 5 } }
          }
        }
      },
      member: {
        roles: {
          add: jest.fn(),
          cache: { has: jest.fn().mockReturnValue(true) }
        }
      }
    });

    await footballCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('already registered')
    }));
    expect(mockFootballUtils.addRegisteredUser).not.toHaveBeenCalled();
  });

  it('should complete registration when only registered for one game', async () => {
    mockFootballUtils.isUserRegistered.mockResolvedValue(true);
    mockWorldCupUtils.isUserRegistered.mockResolvedValue(false);

    const role = { id: '444444444444444444', name: 'Predictor', position: 1 };
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: {
        id: 'guild-1',
        roles: { cache: new Map([[role.id, role]]), fetch: jest.fn() },
        members: {
          me: {
            permissions: { has: jest.fn().mockReturnValue(true) },
            roles: { highest: { position: 5 } }
          }
        }
      },
      member: {
        roles: {
          add: jest.fn().mockResolvedValue(),
          cache: { has: jest.fn() },
          highest: { position: 0 }
        }
      }
    });

    await footballCommand.execute(interaction);

    expect(mockFootballUtils.addRegisteredUser).toHaveBeenCalledWith('user-123');
    expect(mockWorldCupUtils.addRegisteredUser).toHaveBeenCalledWith('user-123');
  });

  it('should reject register when role id missing', async () => {
    jest.resetModules();
    mockConfig.predictionParticipantRoleId = undefined;
    jest.doMock('../../config', () => mockConfig);
    jest.doMock('../../utils/footballUtils', () => mockFootballUtils);
    jest.doMock('../../utils/worldCupUtils', () => mockWorldCupUtils);
    jest.doMock('../../utils/footballClient', () => mockClientApi);
    jest.doMock('../../logger', () => () => ({ info: jest.fn(), error: jest.fn() }));
    footballCommand = require('../../commands/football');

    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') }
    });

    await footballCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('FOOTBALL_PREDICTION_PARTICIPANT_ROLE_ID')
    }));
  });
});
