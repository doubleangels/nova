const { createMockInteraction, createMockGuild } = require('../testUtils');
const { Collection, ActivityType } = require('discord.js');

describe('ready event', () => {
  let readyEvent;
  let mockClient;
  let mockDatabase;
  let mockLogger;
  let mockInstrument;
  let mockReminderUtils;
  let mockMuteModeUtils;
  let mockConfig;

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
      noobiesRoleId: null,
      givePermsFrenRoleId: null
    };
    jest.doMock('../../config', () => mockConfig);

    mockDatabase = {
      initializeDatabase: jest.fn(),
      cleanupOldTrackingUsers: jest.fn(),
      setInviteUsage: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    mockReminderUtils = {
      rescheduleReminder: jest.fn()
    };
    jest.doMock('../../utils/reminderUtils', () => mockReminderUtils);

    mockMuteModeUtils = {
      rescheduleAllMuteKicks: jest.fn()
    };
    jest.doMock('../../utils/muteModeUtils', () => mockMuteModeUtils);

    mockClient = {
      user: {
        id: 'bot-123',
        tag: 'NovaBot#0001',
        setActivity: jest.fn()
      },
      guilds: {
        cache: new Collection()
      }
    };

    readyEvent = require('../../events/ready');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should initialize successfully with default activity', async () => {
    await readyEvent.execute(mockClient);

    expect(mockDatabase.initializeDatabase).toHaveBeenCalled();
    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      "for ways to help! ❤️",
      { type: ActivityType.Watching }
    );
    expect(mockMuteModeUtils.rescheduleAllMuteKicks).toHaveBeenCalledWith(mockClient);
    expect(mockReminderUtils.rescheduleReminder).toHaveBeenCalledWith(mockClient);
    expect(mockDatabase.cleanupOldTrackingUsers).toHaveBeenCalledWith(mockClient);
    expect(mockClient.cleanupInterval).toBeDefined();
  });

  it('should use custom bot status from config mapping', async () => {
    mockConfig.botStatus = 'Nova commands';
    mockConfig.botStatusType = 'listening';

    await readyEvent.execute(mockClient);

    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      'Nova commands',
      { type: ActivityType.Listening }
    );
  });

  it('should default to watching type if status type is unknown', async () => {
    mockConfig.botStatus = 'Nova games';
    mockConfig.botStatusType = 'unknown-type';

    await readyEvent.execute(mockClient);

    expect(mockClient.user.setActivity).toHaveBeenCalledWith(
      'Nova games',
      { type: ActivityType.Watching }
    );
  });

  it('should run scheduled cleanup every hour', async () => {
    await readyEvent.execute(mockClient);

    expect(mockDatabase.cleanupOldTrackingUsers).toHaveBeenCalledTimes(1);

    // Fast-forward 1 hour
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockDatabase.cleanupOldTrackingUsers).toHaveBeenCalledTimes(2);
  });

  it('should catch cleanup errors and not crash startup or interval', async () => {
    mockDatabase.cleanupOldTrackingUsers.mockRejectedValueOnce(new Error('startup cleanup fail'));
    mockDatabase.cleanupOldTrackingUsers.mockRejectedValueOnce(new Error('interval cleanup fail'));

    await readyEvent.execute(mockClient);

    expect(mockInstrument.captureError).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();

    // Fast-forward 1 hour to trigger scheduled cleanup error
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockInstrument.captureError).toHaveBeenCalledTimes(2);
  });

  it('should log warn if noobie role settings are missing', async () => {
    await readyEvent.execute(mockClient);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Noobie message tracking is disabled'));
  });

  it('should log info if noobie role settings are present', async () => {
    mockConfig.noobiesRoleId = 'role-noob';
    mockConfig.givePermsFrenRoleId = 'role-fren';

    await readyEvent.execute(mockClient);
    expect(mockLogger.info).toHaveBeenCalledWith('Noobie message tracking initialized.', expect.any(Object));
  });

  describe('initializeInviteUsage', () => {
    it('should skip invite initialization if client is not in any guild', async () => {
      await readyEvent.execute(mockClient);
      expect(mockLogger.warn).toHaveBeenCalledWith('No guild found for invite usage initialization.');
    });

    it('should skip if bot lacks ManageGuild permission', async () => {
      const mockGuild = createMockGuild();
      mockGuild.members = {
        me: {
          permissions: {
            has: jest.fn().mockReturnValue(false)
          }
        }
      };
      mockClient.guilds.cache.set('guild-1', mockGuild);

      await readyEvent.execute(mockClient);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Bot does not have ManageGuild permission'),
        expect.any(Object)
      );
    });

    it('should fetch invites and set invite usage if permissions exist', async () => {
      const mockInvite = { code: 'code123', uses: 3 };
      const mockGuild = createMockGuild();
      mockGuild.members = {
        me: {
          permissions: {
            has: jest.fn().mockReturnValue(true)
          }
        }
      };
      mockGuild.invites = {
        fetch: jest.fn().mockResolvedValue(new Collection([['code123', mockInvite]]))
      };
      mockClient.guilds.cache.set('guild-1', mockGuild);

      await readyEvent.execute(mockClient);

      expect(mockDatabase.setInviteUsage).toHaveBeenCalledWith(
        mockGuild.id,
        { 'code123': 3 }
      );
    });

    it('should log warning if guild invites store throws error', async () => {
      const mockInvite = { code: 'code123', uses: 3 };
      const mockGuild = createMockGuild();
      mockGuild.members = {
        me: {
          permissions: {
            has: jest.fn().mockReturnValue(true)
          }
        }
      };
      mockGuild.invites = {
        fetch: jest.fn().mockResolvedValue(new Collection([['code123', mockInvite]]))
      };
      mockClient.guilds.cache.set('guild-1', mockGuild);
      mockDatabase.setInviteUsage.mockRejectedValue(new Error('store fail'));

      await readyEvent.execute(mockClient);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize invite usage for guild.'),
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should throw database error if database initialization fails', async () => {
      mockDatabase.initializeDatabase.mockRejectedValue(new Error('⚠️ Failed to initialize database connection.'));

      await expect(readyEvent.execute(mockClient)).rejects.toThrow('⚠️ Failed to initialize database connection.');
      expect(mockInstrument.captureError).toHaveBeenCalled();
    });

    it('should throw specific errors for other failed initialization tasks', async () => {
      const errorCases = [
        ['⚠️ Failed to reschedule mute kicks.', '⚠️ Failed to reschedule mute kicks.'],
        ['⚠️ Failed to reschedule reminders.', '⚠️ Failed to reschedule reminders.'],
        ['⚠️ Failed to set bot activity.', '⚠️ Failed to set bot activity.'],
        ['⚠️ Failed to set bot status.', '⚠️ Failed to set bot status.'],
        ['⚠️ Failed to load voice join times.', '⚠️ Failed to load voice join times.'],
        ['⚠️ Insufficient permissions for bot initialization.', '⚠️ Insufficient permissions for bot initialization.'],
        ['generic error', '⚠️ An unexpected error occurred during bot initialization.']
      ];

      for (const [errText, expectedMessage] of errorCases) {
        mockDatabase.initializeDatabase.mockRejectedValue(new Error(errText));
        await expect(readyEvent.execute(mockClient)).rejects.toThrow(expectedMessage);
      }
    });
  });
});
