const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

describe('worldcup command', () => {
  let worldcupCommand;
  let mockUtils;
  let mockClientApi;
  let mockPromptCommand;
  let mockRepostScoreCommand;
  let mockConfig;
  let mockLogger;
  let mockScheduler;
  let mockScheduledEvents;
  let mockGetBotMember;

  beforeEach(() => {
    jest.resetModules();

    mockPromptCommand = {
      handlePromptSubcommand: jest.fn().mockResolvedValue(),
      handlePromptSelect: jest.fn().mockResolvedValue()
    };

    mockRepostScoreCommand = {
      handleRepostScoreSubcommand: jest.fn().mockResolvedValue(),
      handleRepostScoreSelect: jest.fn().mockResolvedValue()
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
      removeWorldCupUser: jest.fn().mockResolvedValue({
        hadData: true,
        wasRegistered: true,
        predictionCount: 1,
        pendingCount: 0,
        points: 4
      }),
      isWorldCupGameConfigured: jest.fn().mockReturnValue(true),
      isUserRegistered: jest.fn().mockResolvedValue(false),
      addRegisteredUser: jest.fn().mockResolvedValue(),
      setPromptingPaused: jest.fn().mockResolvedValue(),
      getScoredFixtures: jest.fn().mockResolvedValue([]),
      repostFinalScore: jest.fn().mockResolvedValue(true)
    };

    mockScheduler = {
      runWorldCupStartup: jest.fn().mockResolvedValue(),
      repromptWorldCupFixture: jest.fn().mockResolvedValue(true)
    };

    mockScheduledEvents = {
      syncWorldCupScheduledEvents: jest.fn().mockResolvedValue({
        created: 2,
        skipped: 1,
        failed: 0,
        errors: []
      })
    };

    mockGetBotMember = jest.fn(async interaction => {
      if (!interaction?.guild?.members) return null;
      return (
        interaction.guild.members.me ||
        (interaction.guild.members.fetchMe &&
          (await interaction.guild.members.fetchMe()))
      );
    });

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
    jest.doMock('../../utils/footballUtils', () => ({
      removeFootballUser: jest.fn().mockResolvedValue({
        hadData: true,
        wasRegistered: false,
        predictionCount: 2,
        pendingCount: 0,
        points: 6
      })
    }));
    jest.doMock('../../utils/worldCupScheduler', () => mockScheduler);
    jest.doMock('../../utils/worldCupScheduledEvents', () => mockScheduledEvents);
    jest.doMock('../../utils/asyncUtils', () => ({ getBotMember: mockGetBotMember }));
    jest.doMock('../../utils/worldCupClient', () => mockClientApi);
    jest.doMock('../../utils/predictionPromptCommand', () => mockPromptCommand);
    jest.doMock('../../utils/predictionScoreRepostCommand', () => mockRepostScoreCommand);
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

    it('should reject register for bot users', async () => {
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') },
        user: { id: 'bot-1', bot: true, username: 'bot', tag: 'bot#0000' }
      });
      await worldcupCommand.execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Bots cannot register')
      }));
      expect(mockUtils.addRegisteredUser).not.toHaveBeenCalled();
    });

    it('should roll back role when registration persistence fails', async () => {
      mockUtils.addRegisteredUser.mockRejectedValueOnce(new Error('db fail'));
      const mockRole = { id: 'role-1', position: 5, name: 'WC Predictor' };
      const interaction = createMockInteraction({
        options: { getSubcommand: jest.fn().mockReturnValue('register') },
        guild: {
          roles: {
            cache: { get: jest.fn().mockReturnValue(mockRole) },
            fetch: jest.fn()
          },
          members: {
            me: {
              permissions: { has: jest.fn().mockReturnValue(true) },
              roles: { highest: { position: 10 } }
            }
          }
        },
        member: {
          roles: {
            cache: { has: jest.fn().mockReturnValue(false) },
            add: jest.fn().mockResolvedValue(),
            remove: jest.fn().mockResolvedValue()
          }
        }
      });

    await worldcupCommand.execute(interaction);
    expect(interaction.member.roles.remove).toHaveBeenCalledWith(mockRole, 'Prediction registration rollback');
  });

  it('should ignore role rollback failures after registration persistence fails', async () => {
    mockUtils.addRegisteredUser.mockRejectedValueOnce(new Error('db fail'));
    const mockRole = { id: 'role-1', position: 5, name: 'WC Predictor' };
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('register') },
      guild: {
        roles: {
          cache: { get: jest.fn().mockReturnValue(mockRole) },
          fetch: jest.fn()
        },
        members: {
          me: {
            permissions: { has: jest.fn().mockReturnValue(true) },
            roles: { highest: { position: 10 } }
          }
        }
      },
      member: {
        roles: {
          cache: { has: jest.fn().mockReturnValue(false) },
          add: jest.fn().mockResolvedValue(),
          remove: jest.fn().mockRejectedValue(new Error('remove fail'))
        }
      }
    });

    await worldcupCommand.execute(interaction);
    expect(interaction.member.roles.remove).toHaveBeenCalled();
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

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
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

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
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
      embeds: expect.any(Array),
      flags: MessageFlags.Ephemeral
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
          pointsAwarded: 3
        }
      }
    ]);
    mockUtils.getUserPoints.mockResolvedValue(3);

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

  it('should show predictions for another user ephemerally', async () => {
    mockUtils.getUserPredictionFixtureIds.mockResolvedValue([1]);
    mockUtils.getPredictionsForUser.mockResolvedValue([
      {
        fixtureId: 1,
        prediction: {
          homeScore: 2,
          awayScore: 1,
          resultPick: 'home',
          scored: true,
          pointsAwarded: 3
        }
      }
    ]);
    mockUtils.getUserPoints.mockResolvedValue(3);

    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('predictions'),
        getUser: jest.fn().mockReturnValue({ id: '999', displayName: 'Alice' })
      },
      client: {}
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
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

  it('should handle errors via handleError after deferring', async () => {
    mockUtils.getLeaderboard.mockRejectedValue(new Error('fail'));
    const interaction = createMockInteraction({
      client: {},
      options: {
        getSubcommand: jest.fn().mockReturnValue('leaderboard'),
        getInteger: jest.fn().mockReturnValue(null)
      }
    });
    await worldcupCommand.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Something went wrong')
    }));
  });

  it('should reply via handleError when interaction is not deferred', async () => {
    const interaction = createMockInteraction({ deferred: false, replied: false });
    await worldcupCommand.handleError(interaction, new Error('fail'));
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Something went wrong'),
      flags: expect.any(Number)
    });
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

  it('should dispatch prompt select to shared handler', async () => {
    const interaction = createMockInteraction({
      values: ['42'],
      guild: { id: 'g1' }
    });
    await worldcupCommand.handlePromptSelect(interaction);
    expect(mockPromptCommand.handlePromptSelect).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        gameId: 'worldcup',
        repromptFixture: expect.any(Function)
      })
    );
  });

  it('should dispatch repostscore subcommand to shared handler', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('repostscore') },
      guild: { id: 'g1' },
      memberPermissions: { has: jest.fn(p => p === PermissionFlagsBits.Administrator) }
    });
    await worldcupCommand.execute(interaction);
    expect(mockRepostScoreCommand.handleRepostScoreSubcommand).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        gameId: 'worldcup',
        selectCustomId: 'worldcup:repostscore:select'
      })
    );
  });

  it('should dispatch repost score select to shared handler', async () => {
    const interaction = createMockInteraction({
      values: ['42'],
      guild: { id: 'g1' }
    });
    await worldcupCommand.handleRepostScoreSelect(interaction);
    expect(mockRepostScoreCommand.handleRepostScoreSelect).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        gameId: 'worldcup',
        repostFinalScore: expect.any(Function)
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
    expect(mockUtils.setPromptingPaused).toHaveBeenCalledWith(false);
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

  it('should deny addevents for non-administrators', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('addevents') },
      guild: { id: 'guild-1' },
      memberPermissions: { has: jest.fn().mockReturnValue(false) }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('administrators')
    }));
    expect(mockScheduledEvents.syncWorldCupScheduledEvents).not.toHaveBeenCalled();
  });

  it('should sync Discord events for administrators', async () => {
    const guild = {
      id: 'guild-1',
      members: {
        me: {
          permissions: {
            has: jest.fn(perm => perm === PermissionFlagsBits.ManageEvents)
          }
        }
      }
    };
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('addevents') },
      guild,
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockClientApi.getSeasonFixtures).toHaveBeenCalledWith({ forceRefresh: true });
    expect(mockScheduledEvents.syncWorldCupScheduledEvents).toHaveBeenCalledWith(
      guild,
      expect.any(Array)
    );
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ title: 'World Cup Events Created' })
        })
      ])
    }));
  });

  it('should deny addevents when bot lacks Manage Events permission', async () => {
    mockGetBotMember.mockResolvedValue({
      permissions: {
        has: jest.fn(perm => perm !== PermissionFlagsBits.ManageEvents)
      }
    });

    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('addevents') },
      guild: { id: 'guild-1' },
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Manage Events')
    }));
    expect(mockScheduledEvents.syncWorldCupScheduledEvents).not.toHaveBeenCalled();
  });


  it('should deny addevents outside a guild', async () => {
    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('addevents') },
      guild: null
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('server')
    }));
    expect(mockScheduledEvents.syncWorldCupScheduledEvents).not.toHaveBeenCalled();
  });

  it('should deny addevents when API is not configured', async () => {
    mockClientApi.isApiConfigured.mockReturnValue(false);

    const interaction = createMockInteraction({
      options: { getSubcommand: jest.fn().mockReturnValue('addevents') },
      guild: { id: 'guild-1' },
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not set up')
    }));
    expect(mockScheduledEvents.syncWorldCupScheduledEvents).not.toHaveBeenCalled();
  });

  it('should deny removeuser for non-administrators', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('removeuser'),
        getString: jest.fn().mockReturnValue('123456789012345678')
      },
      guild: { id: 'guild-1' },
      memberPermissions: { has: jest.fn().mockReturnValue(false) }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('administrators')
    }));
    expect(mockUtils.removeWorldCupUser).not.toHaveBeenCalled();
  });

  it('should reject invalid user IDs for removeuser', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('removeuser'),
        getString: jest.fn().mockReturnValue('bad-id')
      },
      guild: { id: 'guild-1' },
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('valid Discord user ID')
    }));
    expect(mockUtils.removeWorldCupUser).not.toHaveBeenCalled();
  });

  it('should remove user from both games for administrators', async () => {
    const interaction = createMockInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('removeuser'),
        getString: jest.fn().mockReturnValue('123456789012345678')
      },
      guild: { id: 'guild-1' },
      user: { id: 'admin-1' },
      memberPermissions: {
        has: jest.fn(perm => perm === PermissionFlagsBits.Administrator)
      }
    });

    await worldcupCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockUtils.removeWorldCupUser).toHaveBeenCalledWith('123456789012345678');
    const footballUtils = require('../../utils/footballUtils');
    expect(footballUtils.removeFootballUser).toHaveBeenCalledWith('123456789012345678');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Prediction User Removed' })
        })
      ])
    }));
  });


});
