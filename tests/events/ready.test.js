const { ActivityType } = require('discord.js');

describe('ready event', () => {
  let readyEvent;
  let mockLogger;
  let mockInstrument;
  let mockConfig;
  let mockReminderUtils;
  let mockMuteModeUtils;
  let mockDatabase;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

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
    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      'for ways to help! ❤️',
      { type: ActivityType.Watching }
    );
    expect(mockMuteModeUtils.rescheduleAllMuteKicks).toHaveBeenCalledWith(mockClient);
    expect(mockReminderUtils.rescheduleReminder).toHaveBeenCalledWith(mockClient);
    expect(mockDatabase.cleanupOldTrackingUsers).toHaveBeenCalledWith(mockClient);
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
      const mockClient = {
        user: { tag: 'TestBot#1234', setActivity: jest.fn() },
        guilds: null // Will throw TypeError in cache first access
      };

      await readyEvent.execute(mockClient);

      // Cover lines 114-115
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
    it('should throw database error if database initialization fails', async () => {
      mockDatabase.initializeDatabase.mockRejectedValue(new Error('⚠️ Failed to initialize database connection.'));

      const mockClient = {
        user: { tag: 'TestBot#1234' }
      };

      await expect(readyEvent.execute(mockClient)).rejects.toThrow(
        '⚠️ Failed to initialize database connection.'
      );
    });

    it('should throw specific errors for other failed initialization tasks', async () => {
      const mockClient = {
        user: { tag: 'TestBot#1234' }
      };

      const testErrors = [
        ['⚠️ Failed to reschedule mute kicks.', '⚠️ Failed to reschedule mute kicks.'],
        ['⚠️ Failed to reschedule reminders.', '⚠️ Failed to reschedule reminders.'],
        ['⚠️ Failed to set bot activity.', '⚠️ Failed to set bot activity.'],
        ['⚠️ Failed to set bot status.', '⚠️ Failed to set bot status.'],
        ['⚠️ Failed to load voice join times.', '⚠️ Failed to load voice join times.'],
        ['⚠️ Insufficient permissions for bot initialization.', '⚠️ Insufficient permissions for bot initialization.'],
        ['generic error', '⚠️ An unexpected error occurred during bot initialization.']
      ];

      for (const [errMsg, expectedMsg] of testErrors) {
        mockDatabase.initializeDatabase.mockRejectedValue(new Error(errMsg));
        await expect(readyEvent.execute(mockClient)).rejects.toThrow(expectedMsg);
      }
    });
  });
});
