const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

describe('worldcup command', () => {
  let worldcupCommand;
  let mockUtils;
  let mockClientApi;
  let mockPromptCommand;
  let mockConfig;
  let mockLogger;
  let mockScheduler;

  beforeEach(() => {
    jest.resetModules();

    mockPromptCommand = {
      handlePromptSubcommand: jest.fn().mockResolvedValue(),
      handlePromptSelect: jest.fn().mockResolvedValue()
    };

    mockUtils = {
      getLeaderboard: jest.fn().mockResolvedValue([
        { userId: '111111111111111111', points: 5 }
      ]),
      scoreFinishedFixtures: jest.fn().mockResolvedValue(0),
      formatFixtureLine: jest.fn().mockReturnValue('A vs B'),
      formatResultPickDisplay: jest.fn((fixture, pick) => {
        if (pick === 'home') return fixture?.home ?? 'home';
        if (pick === 'away') return fixture?.away ?? 'away';
        if (pick === 'draw') return 'Draw';
        return pick;
      }),
      getPredictionsForUser: jest.fn().mockResolvedValue([]),
      getUserPredictionFixtureIds: jest.fn().mockResolvedValue([]),
      getAllPredictorUserIds: jest.fn().mockResolvedValue([]),
      getUserPoints: jest.fn().mockResolvedValue(0),
      resetWorldCupGame: jest.fn().mockResolvedValue(),
      isWorldCupGameConfigured: jest.fn().mockReturnValue(true),
      isUserRegistered: jest.fn().mockResolvedValue(false),
      addRegisteredUser: jest.fn().mockResolvedValue(),
      setPromptingPaused: jest.fn().mockResolvedValue()
    };

    mockScheduler = {
      runWorldCupStartup: jest.fn().mockResolvedValue(),
      repromptWorldCupFixture: jest.fn().mockResolvedValue(true)
    };

    mockClientApi = {
      isApiConfigured: jest.fn().mockReturnValue(true),
      getFixtureById: jest.fn().mockResolvedValue(null),
      getSeasonFixtures: jest.fn().mockResolvedValue([
        {
          id: 1,
          home: 'A',
          away: 'B',
          kickoff: '2026-06-01T12:00:00+00:00',
          status: 'NS',
          goals: { home: null, away: null }
        }
      ])
    };

    mockConfig = {
      baseEmbedColor: 0xABCDEF,
      worldCupParticipantRoleId: '444444444444444444',
      worldCupChannelId: '555555555555555555'
    };

    jest.doMock('../../utils/worldCupUtils', () => mockUtils);
    jest.doMock('../../utils/worldCupScheduler', () => mockScheduler);
    jest.doMock('../../utils/worldCupClient', () => mockClientApi);
    jest.doMock('../../utils/predictionPromptCommand', () => mockPromptCommand);
    jest.doMock('../../config', () => mockConfig);
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    worldcupCommand = require('../../commands/worldCup');
  });

  describe('register', () => {
    it('should reply with error if config is missing roleId', async () => {
      mockConfig.worldCupParticipantRoleId = null;
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Registration is not set up')
      }));
    });

    it('should reply with error if outside guild', async () => {
      const interaction = createMockInteraction({
        guild: null,
        options: { getSubcommand: jest.fn().mockReturnValue('register') }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('works in a server')
      }));
    });

    it('should reply already registered if user has role and in db', async () => {
      mockUtils.isUserRegistered.mockResolvedValueOnce(true);
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') },
        member: { roles: { cache: { has: jest.fn().mockReturnValue(true) } } }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      expect(interaction.editReply.mock.calls[0][0].embeds[0].data.title).toContain('Already Registered!');
    });

    it('should reply error if role is missing in guild', async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') },
        guild: {
          roles: {
            cache: { get: jest.fn().mockReturnValue(null) },
            fetch: jest.fn().mockRejectedValue(new Error('not found'))
          }
        }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.editReply.mock.calls[0][0].embeds[0].data.description).toContain('was not found');
    });

    it('should reply error if bot lacks ManageRoles permission', async () => {
      const mockRole = { position: 5 };
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') },
        guild: {
          roles: {
            cache: { get: jest.fn().mockReturnValue(mockRole) }
          },
          members: {
            me: { permissions: { has: jest.fn().mockReturnValue(false) } }
          }
        }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.editReply.mock.calls[0][0].embeds[0].data.description).toContain('Manage Roles');
    });

    it('should reply error if role hierarchy is wrong', async () => {
      const mockRole = { position: 10 };
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') },
        guild: {
          roles: {
            cache: { get: jest.fn().mockReturnValue(mockRole) }
          },
          members: {
            me: {
              permissions: { has: jest.fn().mockReturnValue(true) },
              roles: { highest: { position: 5 } }
            }
          }
        }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.editReply.mock.calls[0][0].embeds[0].data.description).toContain('highest role must be above');
    });

    it('should successfully register the user', async () => {
      const mockRole = { position: 5 };
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') },
        guild: {
          roles: {
            cache: { get: jest.fn().mockReturnValue(mockRole) }
          },
          members: {
            me: {
              permissions: { has: jest.fn().mockReturnValue(true) },
              roles: { highest: { position: 10 } }
            }
          }
        },
        member: {
          roles: { add: jest.fn().mockResolvedValue() }
        }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.member.roles.add).toHaveBeenCalledWith(mockRole, 'Prediction game registration');
      expect(mockUtils.addRegisteredUser).toHaveBeenCalledWith('user-123');
      expect(interaction.editReply.mock.calls[0][0].embeds[0].data.title).toContain('Registered for Predictions!');
    });

    it('should successfully register user when worldCupChannelId is missing', async () => {
      mockConfig.worldCupChannelId = null;
      const mockRole = { position: 5 };
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') },
        guild: {
          roles: {
            cache: { get: jest.fn().mockReturnValue(mockRole) }
          },
          members: {
            me: {
              permissions: { has: jest.fn().mockReturnValue(true) },
              roles: { highest: { position: 10 } }
            }
          }
        },
        member: {
          roles: { add: jest.fn().mockResolvedValue() }
        }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.member.roles.add).toHaveBeenCalledWith(mockRole, 'Prediction game registration');
      expect(interaction.editReply.mock.calls[0][0].embeds[0].data.description).toContain('the prediction channel');
    });
  });

  it('should show leaderboard', async () => {
    const interaction = createMockInteraction({
      client: {},
      options: {
        getSubcommand: jest.fn().mockReturnValue('leaderboard'),
        getInteger: jest.fn().mockReturnValue(null)
      }
    });

    await worldcupCommand.execute(interaction);

    expect(mockUtils.scoreFinishedFixtures).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));
  });

  it('should format leaderboard medals for top three and numeric ranks', async () => {
    mockUtils.getLeaderboard.mockResolvedValue([
      { userId: '111111111111111111', points: 10 },
      { userId: '222222222222222222', points: 8 },
      { userId: '333333333333333333', points: 6 },
      { userId: '444444444444444444', points: 4 }
    ]);
    const interaction = createMockInteraction({
      client: {},
      options: {
        getSubcommand: jest.fn().mockReturnValue('leaderboard'),
        getInteger: jest.fn().mockReturnValue(4)
      }
    });

    await worldcupCommand.execute(interaction);

    const description = interaction.editReply.mock.calls[0][0].embeds[0].data.description;
    expect(description).toContain('🥇');
    expect(description).toContain('🥈');
    expect(description).toContain('🥉');
    expect(description).toContain('4.');
  });

  it('should show rules', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('rules') }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));
  });

  it('should list matches when API configured', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('matches'),
        getString: jest.fn().mockReturnValue(null)
      }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('should show predictions', async () => {
    mockUtils.getUserPredictionFixtureIds.mockResolvedValue([1]);
    mockUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 1,
        prediction: {
          homeScore: 2,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          pointsAwarded: 4
        }
      }
    ]);
    mockUtils.getUserPoints.mockResolvedValue(4);

    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {}
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));
  });

  it('should show predictions for another user publicly', async () => {
    mockUtils.getUserPredictionFixtureIds.mockResolvedValue([1]);
    mockUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 1,
        prediction: {
          homeScore: 2,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          pointsAwarded: 4
        }
      }
    ]);
    mockUtils.getUserPoints.mockResolvedValue(4);

    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: '999', displayName: 'Alice' })
      },
      client: {}
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith();
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toContain("Alice's Predictions");
  });

  it('should show predictions for unknown fixtures and missing predictions', async () => {
    mockUtils.getUserPredictionFixtureIds.mockResolvedValue([100, 200]);
    mockUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 100,
        prediction: {
          homeScore: 1,
          awayScore: 1,
          resultPick: 'draw',
          scored: false,
          pointsAwarded: null
        }
      },
      { fixtureId: 200, prediction: null }
    ]);
    mockClientApi.getSeasonFixtures.mockResolvedValue([]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('Match `100`');
    expect(embed.data.description).toContain('prediction data missing');
  });

  it('should show predictions for unknown fixtures and pending scores', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([]);
    mockUtils.getUserPredictionFixtureIds.mockResolvedValue([999]);
    mockUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 999,
        prediction: {
          homeScore: 1,
          awayScore: 1,
          resultPick: 'draw',
          scored: false
        }
      }
    ]);
    mockUtils.getUserPoints.mockResolvedValue(0);

    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {}
    });

    await worldcupCommand.execute(interaction);

    const description = interaction.editReply.mock.calls[0][0].embeds[0].data.description;
    expect(description).toContain('Match `999`');
    expect(description).toContain('awaiting final score');
  });

  it('should show zero points when scored pick has no pointsAwarded', async () => {
    mockUtils.getUserPredictionFixtureIds.mockResolvedValue([1]);
    mockUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 1,
        prediction: {
          homeScore: 0,
          awayScore: 0,
          resultPick: 'draw',
          scored: true,
          pointsAwarded: null
        }
      }
    ]);

    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {}
    });

    await worldcupCommand.execute(interaction);

    const description = interaction.editReply.mock.calls[0][0].embeds[0].data.description;
    expect(description).toContain('+0');
  });

  it('should reject matches when API missing', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('matches') }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not set up')
    }));
  });

  it('should handle unknown subcommand', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('unknown') }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reject leaderboard when API missing', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('leaderboard'),
        getInteger: jest.fn()
      }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not set up')
    }));
  });

  it('should reject predictions when API missing', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('predictions') }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not set up')
    }));
  });

  it('should sort matches by kickoff when listing multiple fixtures', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([
      { id: 2, home: 'C', away: 'D', kickoff: '2026-06-02T12:00:00+00:00', status: 'NS', goals: { home: null, away: null } },
      { id: 1, home: 'A', away: 'B', kickoff: '2026-06-01T12:00:00+00:00', status: 'NS', goals: { home: null, away: null } }
    ]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('matches'),
        getString: jest.fn().mockReturnValue('upcoming')
      }
    });
    await worldcupCommand.execute(interaction);
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description.indexOf('`1`')).toBeLessThan(embed.data.description.indexOf('`2`'));
  });

  it('should filter upcoming matches', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([
      { id: 1, home: 'A', away: 'B', kickoff: '2026-06-01T12:00:00+00:00', status: 'NS', goals: { home: null, away: null } },
      { id: 2, home: 'C', away: 'D', kickoff: '2026-06-02T12:00:00+00:00', status: 'FT', goals: { home: 1, away: 0 } }
    ]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('matches'),
        getString: jest.fn().mockReturnValue('upcoming')
      }
    });
    await worldcupCommand.execute(interaction);
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('`1`');
    expect(embed.data.description).not.toContain('`2`');
  });

  it('should show empty leaderboard', async () => {
    mockUtils.getLeaderboard.mockResolvedValue([]);
    const interaction = createMockInteraction({
      client: {},
      options: {
        getSubcommand: jest.fn().mockReturnValue('leaderboard'),
        getInteger: jest.fn().mockReturnValue(5)
      }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('leaderboard is empty')
    }));
  });

  it('should filter live and finished matches', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([
      { id: 1, home: 'A', away: 'B', kickoff: '2026-06-01T12:00:00+00:00', status: '1H', goals: { home: 0, away: 0 } },
      { id: 2, home: 'C', away: 'D', kickoff: '2026-06-02T12:00:00+00:00', status: 'FT', goals: { home: 1, away: 0 } }
    ]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('matches'),
        getString: jest.fn().mockReturnValue('live')
      }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();

    interaction.options.getString.mockReturnValue('finished');
    await worldcupCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledTimes(2);
  });

  it('should show empty matches list', async () => {
    mockClientApi.getSeasonFixtures.mockResolvedValue([]);
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('matches'),
        getString: jest.fn().mockReturnValue('upcoming')
      }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('No matches match')
    }));
  });

  it('should show predictions with no predictions for a user', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: 'user-123', displayName: 'test' })
      },
      client: {}
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not submitted any predictions')
    }));
  });

  it('should show all predictions when user is omitted', async () => {
    mockUtils.getAllPredictorUserIds.mockResolvedValue(['111', '222']);
    mockUtils.getUserPredictionFixtureIds.mockImplementation(userId =>
      Promise.resolve(userId === '111' ? [1] : [2])
    );
    mockUtils.getPredictionsForUser.mockImplementation((userId, fixtureIds) =>
      Promise.resolve([{
        fixtureId: fixtureIds[0],
        prediction: {
          homeScore: 1,
          awayScore: 0,
          resultPick: 'home',
          scored: true,
          pointsAwarded: 3
        }
      }])
    );
    mockUtils.getUserPoints.mockImplementation(userId =>
      Promise.resolve(userId === '111' ? 5 : 2)
    );

    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue(null)
      },
      client: {}
    });

    await worldcupCommand.execute(interaction);

    expect(mockUtils.getAllPredictorUserIds).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));
    const description = interaction.editReply.mock.calls[0][0].embeds[0].data.description;
    expect(description).toContain('<@111>');
    expect(description).toContain('<@222>');
  });

  it('should show empty all-predictions message when nobody has picks', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue(null)
      },
      client: {}
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('No one has submitted')
    }));
  });

  it('should handle errors via handleError when deferred', async () => {
    mockUtils.getLeaderboard.mockRejectedValue(new Error('fail'));
    const interaction = createMockInteraction({
      client: {},
      options: {
        getSubcommand: jest.fn().mockReturnValue('leaderboard'),
        getInteger: jest.fn().mockReturnValue(null)
      },
      deferred: true,
      editReply: jest.fn().mockRejectedValue(new Error('edit fail'))
    });
    await worldcupCommand.execute(interaction);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should handle errors via handleError when not deferred', async () => {
    mockUtils.getLeaderboard.mockRejectedValue(new Error('fail'));
    const interaction = createMockInteraction({
      client: {},
      options: {
        getSubcommand: jest.fn().mockReturnValue('leaderboard'),
        getInteger: jest.fn().mockReturnValue(null)
      },
      deferred: false,
      replied: false,
      reply: jest.fn().mockResolvedValue({})
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Something went wrong')
    }));
  });

  it('should reply for unknown subcommand', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('unknown') }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Unknown subcommand')
    }));
  });

  it('should dispatch prompt subcommand to shared handler', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('prompt') },
      guild: { id: 'g1' },
      memberPermissions: { has: jest.fn(p => p === PermissionFlagsBits.Administrator) }
    });
    await worldcupCommand.execute(interaction);
    expect(mockPromptCommand.handlePromptSubcommand).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        gameId: 'worldcup',
        selectCustomId: 'worldcup:prompt:select'
      })
    );
  });

  it('should deny reset for non-administrators', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('reset'),
        getBoolean: jest.fn().mockReturnValue(true)
      },
      guild: { id: 'guild-1' },
      memberPermissions: { has: jest.fn().mockReturnValue(false) }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('administrators')
    }));
    expect(mockUtils.resetWorldCupGame).not.toHaveBeenCalled();
  });

  it('should reset game and repost prompts for administrators', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('reset'),
        getBoolean: jest.fn().mockReturnValue(null)
      },
      guild: { id: 'guild-1' },
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      },
      client: { id: 'bot' }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockUtils.resetWorldCupGame).toHaveBeenCalled();
    expect(mockScheduler.runWorldCupStartup).toHaveBeenCalledWith(interaction.client);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ title: 'World Cup Predictions Reset' })
        })
      ])
    }));
  });

  it('should reset without repost when repost is false', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('reset'),
        getBoolean: jest.fn().mockReturnValue(false)
      },
      guild: { id: 'guild-1' },
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      },
      client: { id: 'bot' }
    });

    await worldcupCommand.execute(interaction);

    expect(mockUtils.resetWorldCupGame).toHaveBeenCalled();
    expect(mockScheduler.runWorldCupStartup).not.toHaveBeenCalled();
  });

  it('should deny reset when executed outside a guild', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('reset'),
        getBoolean: jest.fn().mockReturnValue(true)
      },
      guild: null
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('server')
    }));
    expect(mockUtils.resetWorldCupGame).not.toHaveBeenCalled();
  });

  it('should skip repost and set repostSkippedConfig when API or game is not configured', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);
    mockUtils.isWorldCupGameConfigured.mockReturnValue(false);

    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('reset'),
        getBoolean: jest.fn().mockReturnValue(true)
      },
      guild: { id: 'guild-1' },
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      },
      client: { id: 'bot' }
    });

    await worldcupCommand.execute(interaction);

    expect(mockUtils.resetWorldCupGame).toHaveBeenCalled();
    expect(mockScheduler.runWorldCupStartup).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));
  });

  it('should skip repost and set repostSkippedConfig when game is not configured but API is', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(true);
    mockUtils.isWorldCupGameConfigured.mockReturnValue(false);
    
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('reset'),
        getBoolean: jest.fn().mockReturnValue(true)
      },
      guild: { id: 'guild-1' },
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      },
      client: { id: 'bot' }
    });

    await worldcupCommand.execute(interaction);

    expect(mockUtils.resetWorldCupGame).toHaveBeenCalled();
    expect(mockScheduler.runWorldCupStartup).not.toHaveBeenCalled();
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('Match prompts were not re-posted');
  });

});
