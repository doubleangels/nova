const { Collection } = require('discord.js');

describe('Mute Mode Lifecycle Integration', () => {
  let guildMemberAddEvent;
  let messageCreateEvent;
  let mockLogger;
  let mockInstrument;
  let mockDatabase;
  let mockConfig;
  let mockMuteModeUtils;
  let mockTrollModeUtils;
  let mockSpamModeUtils;

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

    // Use a real in-memory Keyv store mock for integration
    const store = new Map();
    mockDatabase = {
      getValue: jest.fn(async (key) => store.get(key)),
      setValue: jest.fn(async (key, value) => { store.set(key, value); }),
      addMuteModeUser: jest.fn(async (id, tag) => {
        const list = store.get('mute_mode_users') || {};
        list[id] = { id, tag, joinedAt: new Date().toISOString() };
        store.set('mute_mode_users', list);
      }),
      removeMuteModeUser: jest.fn(async (id) => {
        const list = store.get('mute_mode_users') || {};
        delete list[id];
        store.set('mute_mode_users', list);
      }),
      addSpamModeJoinTime: jest.fn().mockResolvedValue(),
      isFormerMember: jest.fn().mockResolvedValue(false),
      getInviteNotificationChannel: jest.fn().mockResolvedValue(null)
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    // Use real muteModeUtils schedule/cancel logic but mock Discord interactions
    const activeKicks = new Map();
    mockMuteModeUtils = {
      scheduleMuteKick: jest.fn((userId, joinedAt, kickTimeHours, client, guildId) => {
        const timeoutId = setTimeout(() => {
          // Perform kick simulation
        }, kickTimeHours * 3600 * 1000);
        activeKicks.set(userId, timeoutId);
      }),
      cancelMuteKick: jest.fn((userId) => {
        const timeoutId = activeKicks.get(userId);
        if (timeoutId) {
          clearTimeout(timeoutId);
          activeKicks.delete(userId);
          return true;
        }
        return false;
      })
    };
    jest.doMock('../../utils/muteModeUtils', () => mockMuteModeUtils);

    mockTrollModeUtils = {
      checkAccountAge: jest.fn().mockResolvedValue(true)
    };
    jest.doMock('../../utils/trollModeUtils', () => mockTrollModeUtils);

    mockSpamModeUtils = {
      trackNewUserMessage: jest.fn().mockResolvedValue()
    };
    jest.doMock('../../utils/spamModeUtils', () => mockSpamModeUtils);

    mockConfig = {
      returningMemberRoleId: 'returning-role',
      newMemberRoleId: 'noobie-role',
      memberFrenRoleId: 'fren-role'
    };
    jest.doMock('../../config', () => mockConfig);

    guildMemberAddEvent = require('../../events/guildMemberAdd');
    messageCreateEvent = require('../../events/messageCreate');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should successfully cycle a member through joining with mute mode, scheduling a kick, and canceling it on message', async () => {
    // 1. Enable mute mode in config
    await mockDatabase.setValue('mute_mode_enabled', true);
    await mockDatabase.setValue('mute_mode_kick_time_hours', '4');

    // 2. Simulate user join
    const mockMember = {
      id: 'new-user-123',
      joinedAt: new Date(),
      user: { bot: false, tag: 'NewUser#1234', id: 'new-user-123' },
      client: 'mock-client',
      guild: { id: 'guild-123' },
      roles: {
        cache: new Collection(),
        add: jest.fn().mockResolvedValue()
      }
    };

    await guildMemberAddEvent.execute(mockMember);

    // Verify user added to database and mute kick scheduled
    expect(mockDatabase.addMuteModeUser).toHaveBeenCalledWith('new-user-123', 'NewUser#1234');
    expect(mockMuteModeUtils.scheduleMuteKick).toHaveBeenCalledWith(
      'new-user-123',
      mockMember.joinedAt,
      4,
      'mock-client',
      'guild-123'
    );

    // 3. Simulate user sending a message within the kick window
    const mockMessage = {
      partial: false,
      author: { bot: false, tag: 'NewUser#1234', id: 'new-user-123' },
      channel: { id: 'chan-general', name: 'general' },
      channelId: 'chan-general',
      content: 'Hello, Frens!'
    };

    await messageCreateEvent.execute(mockMessage);

    // Verify kick cancelled and mute mode tracking removed
    expect(mockMuteModeUtils.cancelMuteKick).toHaveBeenCalledWith('new-user-123');
    expect(mockDatabase.removeMuteModeUser).toHaveBeenCalledWith('new-user-123');
  });
});
