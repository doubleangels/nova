const { ActivityType } = require('discord.js');

describe('ready event', () => {
  let readyEvent;
  let mockLogger;
  let mockInstrument;
  let mockConfig;
  let mockReminderUtils;
  let mockMuteModeUtils;
  let mockDatabase;
  let mockWorldCupScheduler;
  let mockResolvePrimaryGuild;
  let mockWriteBotHeartbeat;
  let realGuildResolver;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    realGuildResolver = jest.requireActual('../../utils/guildResolver');

    mockWriteBotHeartbeat = jest.fn();
    mockResolvePrimaryGuild = jest.fn((client, options) =>
      realGuildResolver.resolvePrimaryGuild(client, options)
    );

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    mockInstrument = {
      captureError: jest.fn()
    };
    jest.doMock('../../instrument', () => mockInstrument);

    mockConfig = {
      botStatus: null,
      botStatusType: null,
      newMemberRoleId: null,
      memberFrenRoleId: null,
      settings: {
        rescheduleReminderOnStart: true,
        rescheduleAllMuteKicksOnStart: true
      }
    };
    jest.doMock('../../config', () => mockConfig);

    mockReminderUtils = {
      rescheduleReminder: jest.fn().mockResolvedValue()
    };
    jest.doMock('../../utils/reminderUtils', () => mockReminderUtils);

    mockMuteModeUtils = {
      rescheduleAllMuteKicks: jest.fn().mockResolvedValue()
    };
    jest.doMock('../../utils/muteModeUtils', () => mockMuteModeUtils);

    mockDatabase = {
      initializeDatabase: jest.fn().mockResolvedValue(),
      cleanupOldTrackingUsers: jest.fn().mockResolvedValue(),
      setInviteUsage: jest.fn().mockResolvedValue()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    mockWorldCupScheduler = {
      startWorldCupScheduler: jest.fn()
    };
    jest.doMock('../../utils/worldCupScheduler', () => mockWorldCupScheduler);

    jest.doMock('../../utils/footballScheduler', () => ({
      startFootballScheduler: jest.fn()
    }));

    jest.doMock('../../utils/guildResolver', () => ({
      resolvePrimaryGuild: (...args) => mockResolvePrimaryGuild(...args)
    }));

    jest.doMock('../../utils/botHealth', () => ({
      writeBotHeartbeat: (...args) => mockWriteBotHeartbeat(...args)
    }));

    jest.doMock('../../utils/inviteInitGate', () => ({
      resetInviteInitGate: jest.fn(),
      markInviteInitComplete: jest.fn()
    }));

    readyEvent = require('../../events/ready');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should initialize successfully with default activity', async () => {
    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockDatabase.initializeDatabase).toHaveBeenCalled();
    expect(mockWorldCupScheduler.startWorldCupScheduler).toHaveBeenCalledWith(mockClient);
    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      'for ways to help! ❤️',
      { type: ActivityType.Watching }
    );
    expect(mockMuteModeUtils.rescheduleAllMuteKicks).toHaveBeenCalledWith(mockClient);
    expect(mockReminderUtils.rescheduleReminder).toHaveBeenCalledWith(mockClient);
    expect(mockDatabase.cleanupOldTrackingUsers).toHaveBeenCalledWith(mockClient);
  });

  it('should pass configured GUILD_ID to the guild resolver', async () => {
    mockConfig.guildId = '222222222222222222';
    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockResolvePrimaryGuild).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ guildId: '222222222222222222' })
    );
  });

  it('should log heartbeat write failures from the interval', async () => {
    mockWriteBotHeartbeat
      .mockImplementationOnce(undefined)
      .mockImplementationOnce(() => {
        throw new Error('heartbeat fail');
      });
    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);
    jest.advanceTimersByTime(61_000);

    expect(mockInstrument.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      { event: 'ready', handler: 'heartbeat' }
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to write bot heartbeat.',
      expect.objectContaining({ err: expect.any(Error) })
    );
  });

  it('should skip startup reschedule when config flags are false', async () => {
    mockConfig.settings.rescheduleAllMuteKicksOnStart = false;
    mockConfig.settings.rescheduleReminderOnStart = false;

    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockMuteModeUtils.rescheduleAllMuteKicks).not.toHaveBeenCalled();
    expect(mockReminderUtils.rescheduleReminder).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Skipping mute kick reschedule on startup (rescheduleAllMuteKicksOnStart is false).'
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Skipping reminder reschedule on startup (rescheduleReminderOnStart is false).'
    );
  });

  it('should use custom bot status from config mapping', async () => {
    mockConfig.botStatus = 'new features';
    mockConfig.botStatusType = 'playing';

    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      'new features',
      { type: ActivityType.Playing }
    );
  });

  it('should default to watching type if status type is unknown', async () => {
    mockConfig.botStatus = 'something';
    mockConfig.botStatusType = 'invalid';

    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      'something',
      { type: ActivityType.Watching }
    );
  });

  it('should fall back to watching when streaming is configured without stream URL', async () => {
    mockConfig.botStatus = 'live stream';
    mockConfig.botStatusType = 'streaming';
    mockConfig.botStatusStreamUrl = null;

    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'BOT_STATUS_TYPE is streaming but BOT_STATUS_STREAM_URL is not set; using Watching instead.'
    );
    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      'live stream',
      { type: ActivityType.Watching }
    );
  });

  it('should use stream URL when streaming activity is configured', async () => {
    mockConfig.botStatus = 'live stream';
    mockConfig.botStatusType = 'streaming';
    mockConfig.botStatusStreamUrl = 'https://twitch.tv/nova';

    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      'live stream',
      { type: ActivityType.Streaming, url: 'https://twitch.tv/nova' }
    );
  });

  it('should log startup task failures from Promise.allSettled', async () => {
    mockMuteModeUtils.rescheduleAllMuteKicks.mockRejectedValue(new Error('mute reschedule fail'));

    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockInstrument.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      { event: 'ready', handler: 'startupTask' }
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Startup reschedule task failed.',
      expect.objectContaining({ err: expect.any(Error) })
    );
  });

  it('should run scheduled cleanup every hour', async () => {
    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockClient.cleanupInterval).toBeDefined();

    // Advance timers by 1 hour
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockDatabase.cleanupOldTrackingUsers).toHaveBeenCalledTimes(2); // startup + 1 hour
  });

  it('should catch cleanup errors and not crash startup or interval', async () => {
    mockDatabase.cleanupOldTrackingUsers.mockRejectedValue(new Error('Cleanup failed'));

    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockInstrument.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      { event: 'ready', handler: 'initialCleanup' }
    );

    // Advance timers by 1 hour
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockInstrument.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      { event: 'ready', handler: 'scheduledCleanup' }
    );
  });

  it('should log warn if noobie role settings are missing', async () => {
    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('New Member message tracking is disabled')
    );
  });

  it('should log info if noobie role settings are present', async () => {
    mockConfig.newMemberRoleId = 'role-1';
    mockConfig.memberFrenRoleId = 'role-2';

    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('New Member message tracking initialized.'),
      expect.any(Object)
    );
  });

  it('should warn through the guild resolver when the bot is not in any guild', async () => {
    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: {
          first: jest.fn().mockReturnValue(null)
        }
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockLogger.warn).toHaveBeenCalledWith('Bot is not in any guild.', undefined);
  });

  it('should warn when multiple guilds exist without GUILD_ID configured', async () => {
    const guildA = { id: '111111111111111111', name: 'A' };
    const guildB = { id: '222222222222222222', name: 'B' };
    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: new Map([
          [guildA.id, guildA],
          [guildB.id, guildB]
        ])
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Bot is in multiple guilds but GUILD_ID is not set; using the first guild.',
      expect.objectContaining({ guildIds: [guildA.id, guildB.id] })
    );
  });

  it('should warn when configured GUILD_ID does not match a joined guild', async () => {
    mockConfig.guildId = '999999999999999999';
    const guildA = { id: '111111111111111111', name: 'A' };
    const mockClient = {
      user: { tag: 'TestBot#1234', setActivity: jest.fn() },
      guilds: {
        cache: new Map([[guildA.id, guildA]])
      }
    };

    await readyEvent.execute(mockClient);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'GUILD_ID is set but the bot is not a member of that guild.',
      expect.objectContaining({ guildId: '999999999999999999' })
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'No guild found for invite usage initialization.'
    );
  });

  describe('initializeInviteUsage', () => {
    it('should skip invite initialization if client is not in any guild', async () => {
      const mockClient = {
        user: { tag: 'TestBot#1234', setActivity: jest.fn() },
        guilds: {
          cache: {
            first: jest.fn().mockReturnValue(null)
          }
        }
      };

      await readyEvent.execute(mockClient);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No guild found for invite usage initialization.'
      );
    });

    it('should skip if bot lacks ManageGuild permission', async () => {
      const mockGuild = {
        name: 'Guild 1',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(false)
            }
          }
        }
      };
      const mockClient = {
        user: { tag: 'TestBot#1234', setActivity: jest.fn() },
        guilds: {
          cache: {
            first: jest.fn().mockReturnValue(mockGuild)
          }
        }
      };

      await readyEvent.execute(mockClient);

      expect(mockGuild.members.me.permissions.has).toHaveBeenCalledWith('ManageGuild');
    });

    it('should fetch invites and set invite usage if permissions exist', async () => {
      const mockInvite1 = { code: 'abc', uses: 5 };
      const mockGuild = {
        id: 'guild-1',
        name: 'Guild 1',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue({
            each: jest.fn().mockImplementation((cb) => cb(mockInvite1))
          })
        }
      };
      const mockClient = {
        user: { tag: 'TestBot#1234', setActivity: jest.fn() },
        guilds: {
          cache: {
            first: jest.fn().mockReturnValue(mockGuild)
          }
        }
      };

      await readyEvent.execute(mockClient);

      expect(mockGuild.invites.fetch).toHaveBeenCalled();
      expect(mockDatabase.setInviteUsage).toHaveBeenCalledWith('guild-1', { abc: 5 });
    });

    it('should log warning if guild invites store throws error', async () => {
      const mockGuild = {
        id: 'guild-1',
        name: 'Guild 1',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          // fetch is undefined, so calling fetch() will throw a TypeError!
        }
      };
      const mockClient = {
        user: { tag: 'TestBot#1234', setActivity: jest.fn() },
        guilds: {
          cache: {
            first: jest.fn().mockReturnValue(mockGuild)
          }
        }
      };

      await readyEvent.execute(mockClient);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to initialize invite usage for guild.',
        expect.any(Object)
      );
    });

    it('should handle invites without uses count and use 0 as default', async () => {
      const mockInvite1 = { code: 'abc' }; // uses is missing
      const mockGuild = {
        id: 'guild-1',
        name: 'Guild 1',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockResolvedValue({
            each: jest.fn().mockImplementation((cb) => cb(mockInvite1))
          })
        }
      };
      const mockClient = {
        user: { tag: 'TestBot#1234', setActivity: jest.fn() },
        guilds: {
          cache: {
            first: jest.fn().mockReturnValue(mockGuild)
          }
        }
      };

      await readyEvent.execute(mockClient);

      expect(mockDatabase.setInviteUsage).toHaveBeenCalledWith('guild-1', { abc: 0 });
    });

    it('should do nothing if guild invites fetch catches and returns null', async () => {
      const mockGuild = {
        id: 'guild-1',
        name: 'Guild 1',
        members: {
          me: {
            permissions: {
              has: jest.fn().mockReturnValue(true)
            }
          }
        },
        invites: {
          fetch: jest.fn().mockRejectedValue(new Error('Fetch failed'))
        }
      };
      const mockClient = {
        user: { tag: 'TestBot#1234', setActivity: jest.fn() },
        guilds: {
          cache: {
            first: jest.fn().mockReturnValue(mockGuild)
          }
        }
      };

      await readyEvent.execute(mockClient);

      expect(mockDatabase.setInviteUsage).not.toHaveBeenCalled();
    });

    it('should catch and log error if initializeInviteUsage throws', async () => {
      let resolverCalls = 0;
      mockResolvePrimaryGuild.mockImplementation((client, options) => {
        resolverCalls += 1;
        if (resolverCalls === 2) {
          throw new TypeError('resolver failed');
        }
        return realGuildResolver.resolvePrimaryGuild(client, options);
      });

      const mockGuild = { id: 'guild-1', name: 'Guild 1' };
      const mockClient = {
        user: { tag: 'TestBot#1234', setActivity: jest.fn() },
        guilds: {
          cache: new Map([[mockGuild.id, mockGuild]])
        }
      };

      await readyEvent.execute(mockClient);

      expect(mockInstrument.captureError).toHaveBeenCalledWith(
        expect.any(TypeError),
        { event: 'ready', handler: 'initializeInviteUsage' }
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize invite usage tracking.',
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should log database initialization failures without rethrowing', async () => {
      mockDatabase.initializeDatabase.mockRejectedValue(new Error('⚠️ Failed to initialize database connection.'));

      const mockClient = {
        user: { tag: 'TestBot#1234' }
      };

      await expect(readyEvent.execute(mockClient)).resolves.toBeUndefined();
      expect(mockInstrument.captureError).toHaveBeenCalled();
    });

    it('should log other initialization failures without rethrowing', async () => {
      const mockClient = {
        user: { tag: 'TestBot#1234' }
      };

      const testErrors = [
        '⚠️ Failed to reschedule mute kicks.',
        '⚠️ Failed to reschedule reminders.',
        'generic error'
      ];

      for (const errMsg of testErrors) {
        mockInstrument.captureError.mockClear();
        mockDatabase.initializeDatabase.mockRejectedValue(new Error(errMsg));
        await expect(readyEvent.execute(mockClient)).resolves.toBeUndefined();
        expect(mockInstrument.captureError).toHaveBeenCalled();
      }
    });
  });
});
