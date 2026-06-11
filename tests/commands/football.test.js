const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

describe('football command', () => {
  let footballCommand;
  let mockFootballUtils;
  let mockWorldCupUtils;
  let mockClientApi;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();

    mockFootballUtils = {
      isUserRegistered: jest.fn().mockResolvedValue(false),
      addRegisteredUser: jest.fn().mockResolvedValue(),
      resetFootballGame: jest.fn().mockResolvedValue(),
      setPromptingPaused: jest.fn().mockResolvedValue(),
      isFootballGameConfigured: jest.fn().mockReturnValue(true),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0),
      getLeaderboard: jest.fn().mockResolvedValue([{ userId: '111', points: 5 }]),
      getUserPredictionFixtureIds: jest.fn().mockResolvedValue([]),
      getAllPredictorUserIds: jest.fn().mockResolvedValue([]),
      getPredictionsForUser: jest.fn().mockResolvedValue([]),
      getUserPoints: jest.fn().mockResolvedValue(0),
      formatFixtureLine: jest.fn().mockReturnValue('A vs B'),
      formatResultPickDisplay: jest.fn().mockReturnValue('A')
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
      footballParticipantRoleId: '444444444444444444',
      footballChannelId: '555555555555555555'
    };

    jest.doMock('../../utils/footballUtils', () => mockFootballUtils);
    jest.doMock('../../utils/worldCupUtils', () => mockWorldCupUtils);
    jest.doMock('../../utils/footballClient', () => mockClientApi);
    jest.doMock('../../utils/footballCompetitions', () => ({
      getCompetitionName: (code) => code
    }));
    jest.doMock('../../config', () => mockConfig);

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    footballCommand = require('../../commands/football');
  });

  it('should register user for football and assign role', async () => {
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
    expect(mockFootballUtils.addRegisteredUser).toHaveBeenCalledWith('user-123');
    expect(interaction.member.roles.add).toHaveBeenCalledWith(role, 'Prediction game registration');
    expect(mockFootballUtils.addRegisteredUser.mock.invocationCallOrder[0]).toBeLessThan(
      interaction.member.roles.add.mock.invocationCallOrder[0]
    );
    expect(mockWorldCupUtils.addRegisteredUser).not.toHaveBeenCalled();
    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds).toHaveLength(1);
    expect(reply.embeds[0].data.title).toBe('Registered for Predictions!');
    expect(reply.embeds[0].data.description).toContain('Club football');
  });

  it('should register user with fallback channelRef when channelId is not configured', async () => {
    mockConfig.footballChannelId = undefined;
    const role = { id: '444444444444444444', name: 'Predictor', position: 1 };
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: {
        id: 'guild-1',
        roles: { cache: new Map([[role.id, role]]), fetch: jest.fn() },
        members: { me: { permissions: { has: jest.fn().mockReturnValue(true) }, roles: { highest: { position: 5 } } } }
      },
      member: { roles: { add: jest.fn().mockResolvedValue(), cache: { has: jest.fn() }, highest: { position: 0 } } }
    });

    await footballCommand.execute(interaction);

    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds[0].data.description).toContain('the prediction channel');
  });

  it('should report already registered when already in football', async () => {
    mockFootballUtils.isUserRegistered.mockResolvedValue(true);

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

    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds[0].data.title).toBe('Already Registered!');
    expect(reply.embeds[0].data.description).toContain('already registered');
    expect(mockFootballUtils.addRegisteredUser).not.toHaveBeenCalled();
  });

  it('should proceed with registration when not yet in football', async () => {
    mockFootballUtils.isUserRegistered.mockResolvedValue(false);

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
    expect(mockWorldCupUtils.addRegisteredUser).not.toHaveBeenCalled();
  });

  it('should reject register when role id missing', async () => {
    jest.resetModules();
    mockConfig.footballParticipantRoleId = undefined;
    jest.doMock('../../config', () => mockConfig);
    jest.doMock('../../utils/footballUtils', () => mockFootballUtils);
    jest.doMock('../../utils/worldCupUtils', () => mockWorldCupUtils);
    jest.doMock('../../utils/footballClient', () => mockClientApi);
    
    mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    jest.doMock('../../logger', () => () => mockLogger);
    footballCommand = require('../../commands/football');

    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') }
    });

    await footballCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('FOOTBALL_PREDICTION_PARTICIPANT_ROLE_ID')
    }));
  });

  it('should reject register outside a guild', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: null,
      member: null
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('server')
    }));
  });

  it('should show role missing error when role not found', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: {
        id: 'guild-1',
        roles: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) },
        members: { me: { permissions: { has: jest.fn().mockReturnValue(true) }, roles: { highest: { position: 5 } } } }
      },
      member: { roles: { add: jest.fn(), cache: { has: jest.fn().mockReturnValue(false) } } }
    });
    await footballCommand.execute(interaction);
    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds[0].data.description).toContain('participant role was not found');
  });

  it('should show role missing error when role fetch fails (covers catch)', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: {
        id: 'guild-1',
        roles: { cache: new Map(), fetch: jest.fn().mockRejectedValue(new Error('Discord API error')) },
        members: { me: { permissions: { has: jest.fn().mockReturnValue(true) }, roles: { highest: { position: 5 } } } }
      },
      member: { roles: { add: jest.fn(), cache: { has: jest.fn().mockReturnValue(false) } } }
    });
    await footballCommand.execute(interaction);
    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds[0].data.description).toContain('participant role was not found');
  });

  it('should show manage roles error when bot lacks permission', async () => {
    const role = { id: '444444444444444444', name: 'Predictor', position: 1 };
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: {
        id: 'guild-1',
        roles: { cache: new Map([[role.id, role]]), fetch: jest.fn() },
        members: { me: { permissions: { has: jest.fn().mockReturnValue(false) }, roles: { highest: { position: 5 } } } }
      },
      member: { roles: { add: jest.fn(), cache: { has: jest.fn().mockReturnValue(false) } } }
    });
    await footballCommand.execute(interaction);
    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds[0].data.description).toContain('Manage Roles');
  });

  it('should show role hierarchy error when bot role is too low', async () => {
    const role = { id: '444444444444444444', name: 'Predictor', position: 10 };
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: {
        id: 'guild-1',
        roles: { cache: new Map([[role.id, role]]), fetch: jest.fn() },
        members: { me: { permissions: { has: jest.fn().mockReturnValue(true) }, roles: { highest: { position: 5 } } } }
      },
      member: { roles: { add: jest.fn(), cache: { has: jest.fn().mockReturnValue(false) } } }
    });
    await footballCommand.execute(interaction);
    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.embeds[0].data.description).toContain('highest role must be above');
  });

  it('should show leaderboard', async () => {
    mockFootballUtils.getLeaderboard.mockResolvedValue([
      { userId: '111', points: 5 },
      { userId: '222', points: 4 },
      { userId: '333', points: 3 },
      { userId: '444', points: 2 }
    ]);
    mockFootballUtils.scoreFinishedFixtures.mockResolvedValue(0);
    const interaction = createMockInteraction({
      client: {},
      options: { getSubcommand: jest.fn().mockReturnValue('leaderboard'), getInteger: jest.fn().mockReturnValue(null) }
    });
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('should show empty leaderboard', async () => {
    mockFootballUtils.getLeaderboard.mockResolvedValue([]);
    const interaction = createMockInteraction({
      client: {},
      options: { getSubcommand: jest.fn().mockReturnValue('leaderboard'), getInteger: jest.fn().mockReturnValue(null) }
    });
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('leaderboard is empty') }));
  });

  it('should reject leaderboard when API not configured', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('leaderboard'), getInteger: jest.fn() }
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('not set up') }));
  });

  it('should show rules', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('rules') }
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('should list matches', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([
      { id: 1, home: 'A', away: 'B', kickoff: '2026-06-02T12:00:00Z', status: 'NS', goals: { home: null, away: null } },
      { id: 2, home: 'C', away: 'D', kickoff: '2026-06-01T12:00:00Z', status: 'NS', goals: { home: null, away: null } }
    ]);
    mockFootballUtils.formatFixtureLine = jest.fn().mockReturnValue('A vs B');
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('matches'), getString: jest.fn().mockReturnValue(null) }
    });
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('should filter matches by competition', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([
      { id: 1, home: 'A', away: 'B', kickoff: '2026-06-01T12:00:00Z', status: 'NS', competitionCode: 'PL' }
    ]);
    mockFootballUtils.formatFixtureLine = jest.fn().mockReturnValue('A vs B');
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('matches'),
        getString: jest.fn().mockImplementation(name => name === 'competition' ? 'PL' : null)
      }
    });
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('should filter matches live and finished', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([
      { id: 1, home: 'A', away: 'B', kickoff: '2026-06-01T12:00:00Z', status: '1H' },
      { id: 2, home: 'C', away: 'D', kickoff: '2026-06-02T12:00:00Z', status: 'FT' }
    ]);
    mockFootballUtils.formatFixtureLine = jest.fn().mockReturnValue('X vs Y');
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('matches'),
        getString: jest.fn().mockReturnValue('live')
      }
    });
    await footballCommand.execute(interaction);
    interaction.options.getString.mockReturnValue('finished');
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('should handle errors via handleError when replied', async () => {
    mockFootballUtils.getLeaderboard.mockRejectedValue(new Error('Test error'));
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('leaderboard'), getInteger: jest.fn().mockReturnValue(null) },
      replied: true,
      deferred: false
    });
    interaction.editReply = jest.fn().mockResolvedValue();
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('should handle errors via handleError when not deferred', async () => {
    mockFootballUtils.getLeaderboard.mockRejectedValue(new Error('Test error'));
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('leaderboard'), getInteger: jest.fn().mockReturnValue(null) },
      deferred: false,
      replied: false
    });
    interaction.reply = jest.fn().mockResolvedValue();
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should log error when handleError fails to send reply', async () => {
    mockFootballUtils.getLeaderboard.mockRejectedValue(new Error('Test error'));
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('leaderboard'), getInteger: jest.fn().mockReturnValue(null) },
      deferred: false,
      replied: false
    });
    interaction.reply = jest.fn().mockRejectedValue(new Error('reply fail'));
    await footballCommand.execute(interaction);
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to send football error reply.', expect.any(Object));
  });

  it('should show empty matches after filtering', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([
      { id: 1, home: 'A', away: 'B', kickoff: '2026-06-01T12:00:00Z', status: 'FT', goals: { home: null, away: null } }
    ]);
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('matches'), getString: jest.fn().mockReturnValue('upcoming') }
    });
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No matches match') }));
  });

  it('should reject matches when API not configured', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('matches'), getString: jest.fn().mockReturnValue(null) }
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('not set up') }));
  });

  it('should show predictions', async () => {
    mockFootballUtils.getUserPredictionFixtureIds.mockResolvedValue([1]);
    mockFootballUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 1,
        prediction: { homeScore: 1, awayScore: 0, resultPick: 'home', scored: true, pointsAwarded: 3 }
      }
    ]);
    mockFootballUtils.getUserPoints.mockResolvedValue(3);
    mockClientApi.getSeasonFixtures.mockResolvedValue([
      { id: 1, home: 'A', away: 'B', kickoff: '2026-06-01T12:00:00Z', status: 'FT', goals: { home: 1, away: 0 } }
    ]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {}
    });
    await footballCommand.execute(interaction);
    expect(interaction.deferReply).toHaveBeenCalledWith();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('should show predictions with no predictions for a user', async () => {
    mockFootballUtils.getUserPredictionFixtureIds = jest.fn().mockResolvedValue([]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {}
    });
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('not submitted any predictions') }));
  });

  it('should show predictions with missing prediction data', async () => {
    mockFootballUtils.getUserPredictionFixtureIds.mockResolvedValue([999]);
    mockFootballUtils.getPredictionsForUser.mockResolvedValue([
      { fixtureId: 999, prediction: null }
    ]);
    mockClientApi.getSeasonFixtures.mockResolvedValue([]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {}
    });
    await footballCommand.execute(interaction);
    const call = interaction.editReply.mock.calls[0][0];
    const text = call.embeds ? call.embeds[0].data.description : call.content;
    expect(text).toContain('999');
  });

  it('should show predictions for unknown fixture (no fixture in map)', async () => {
    mockFootballUtils.getUserPredictionFixtureIds.mockResolvedValue([999]);
    mockFootballUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 999,
        prediction: { homeScore: 1, awayScore: 1, resultPick: 'draw', scored: false }
      }
    ]);
    mockFootballUtils.getUserPoints.mockResolvedValue(0);
    mockClientApi.getSeasonFixtures.mockResolvedValue([]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {}
    });
    await footballCommand.execute(interaction);
    const call = interaction.editReply.mock.calls[0][0];
    const text = call.embeds ? call.embeds[0].data.description : call.content;
    expect(text).toContain('999');
  });

  it('should show all predictions when user is omitted', async () => {
    mockFootballUtils.getAllPredictorUserIds.mockResolvedValue(['111']);
    mockFootballUtils.getUserPredictionFixtureIds.mockResolvedValue([1]);
    mockFootballUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 1,
        prediction: { homeScore: 2, awayScore: 1, resultPick: 'home', scored: true, pointsAwarded: 4 }
      }
    ]);
    mockFootballUtils.getUserPoints.mockResolvedValue(4);

    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue(null)
      },
      client: {}
    });
    await footballCommand.execute(interaction);
    expect(mockFootballUtils.getAllPredictorUserIds).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('should reject predictions when API not configured', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('predictions') }
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('not set up') }));
  });

  it('should deny reset outside a guild', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('reset'), getBoolean: jest.fn().mockReturnValue(true) },
      guild: null
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('server') }));
  });

  it('should deny reset for non-administrators', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('reset'), getBoolean: jest.fn().mockReturnValue(true) },
      guild: { id: 'g1' },
      memberPermissions: { has: jest.fn().mockReturnValue(false) }
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('administrators') }));
  });

  it('should reset and repost for administrators', async () => {
    jest.doMock('../../utils/footballScheduler', () => ({ runFootballStartup: jest.fn().mockResolvedValue() }));
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('reset'), getBoolean: jest.fn().mockReturnValue(null) },
      guild: { id: 'g1' },
      memberPermissions: { has: jest.fn(p => p === PermissionFlagsBits.Administrator) },
      client: { id: 'bot' }
    });
    await footballCommand.execute(interaction);
    expect(mockFootballUtils.resetFootballGame).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('should reset without repost when repost is false', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('reset'), getBoolean: jest.fn().mockReturnValue(false) },
      guild: { id: 'g1' },
      memberPermissions: { has: jest.fn(p => p === PermissionFlagsBits.Administrator) },
      client: { id: 'bot' }
    });
    await footballCommand.execute(interaction);
    expect(mockFootballUtils.resetFootballGame).toHaveBeenCalled();
  });

  it('should skip repost when API not configured on reset', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);
    mockFootballUtils.isFootballGameConfigured.mockReturnValue(false);
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('reset'), getBoolean: jest.fn().mockReturnValue(true) },
      guild: { id: 'g1' },
      memberPermissions: { has: jest.fn(p => p === PermissionFlagsBits.Administrator) },
      client: { id: 'bot' }
    });
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('should handle unknown subcommand', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('unknown') }
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Unknown subcommand') }));
  });

  it('should handle errors via handleError when deferred', async () => {
    mockFootballUtils.scoreFinishedFixtures = jest.fn().mockRejectedValue(new Error('fail'));
    mockFootballUtils.getLeaderboard = jest.fn().mockRejectedValue(new Error('fail'));
    const interaction = createMockInteraction({
      client: {},
      options: { getSubcommand: jest.fn().mockReturnValue('leaderboard'), getInteger: jest.fn().mockReturnValue(null) },
      deferred: true
    });
    await footballCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('should handle errors via handleError when not deferred', async () => {
    mockClientApi.getSeasonFixtures.mockRejectedValue(new Error('fail'));
    mockFootballUtils.scoreFinishedFixtures = jest.fn().mockResolvedValue(0);
    mockFootballUtils.getUserPredictionFixtureIds = jest.fn().mockRejectedValue(new Error('fail'));
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {},
      deferred: false,
      replied: false
    });
    await footballCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Something went wrong') }));
  });
});
