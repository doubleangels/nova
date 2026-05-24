const dayjs = require('dayjs');
const { Collection, PermissionFlagsBits } = require('discord.js');
const {
  createMockGuild,
  createMockMember,
  createMockMessage,
  createMockRole
} = require('../testUtils');

const TRACKED_USER_ID = '123456789012345678';
const SPAM_CHANNEL_ID = 'warn-channel-123';
const LONG_SPAM_CONTENT =
  'This is a sufficiently long duplicate spam message for testing purposes here today';

describe('Spam Detection Integration Flow', () => {
  let messageCreateEvent;
  let interactionCreateEvent;
  let mockLogger;
  let mockInstrument;
  let mockDatabase;
  let mockMuteModeUtils;
  let mockConfig;
  let mockWarnChannel;
  let store;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));
    store = new Map();

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
      newMemberRoleId: 'noobie-role',
      memberFrenRoleId: 'fren-role'
    };
    jest.doMock('../../config', () => mockConfig);

    const joinTime = dayjs().subtract(30, 'minute').toDate();
    mockDatabase = {
      getValue: jest.fn(async (key) => store.get(key) ?? null),
      setValue: jest.fn(async (key, value) => {
        store.set(key, value);
      }),
      addSpamModeJoinTime: jest.fn(async (userId) => {
        const map = store.get('spam_mode_join_times') || {};
        map[userId] = joinTime.toISOString();
        store.set('spam_mode_join_times', map);
      }),
      getSpamModeJoinTime: jest.fn(async (userId) => {
        const map = store.get('spam_mode_join_times') || {};
        const raw = map[userId];
        return raw ? new Date(raw) : null;
      }),
      removeSpamModeJoinTime: jest.fn(async (userId) => {
        const map = store.get('spam_mode_join_times') || {};
        delete map[userId];
        store.set('spam_mode_join_times', map);
      }),
      isFormerMember: jest.fn().mockResolvedValue(false),
      incrementMessageCount: jest.fn().mockResolvedValue(1),
      deleteMessageCount: jest.fn().mockResolvedValue(),
      removeMuteModeUser: jest.fn().mockResolvedValue(),
      getInviteNotificationChannel: jest.fn().mockResolvedValue(null)
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    mockMuteModeUtils = {
      cancelMuteKick: jest.fn().mockReturnValue(false)
    };
    jest.doMock('../../utils/muteModeUtils', () => mockMuteModeUtils);

    jest.doMock('../../utils/reminderUtils', () => ({
      handleReminder: jest.fn().mockResolvedValue()
    }));

    messageCreateEvent = require('../../events/messageCreate');
    interactionCreateEvent = require('../../events/interactionCreate');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setupSpamConfig() {
    const joinTime = dayjs().subtract(30, 'minute').toDate();
    store.set('spam_mode_enabled', true);
    store.set('spam_mode_window_hours', '4');
    store.set('spam_mode_threshold', '3');
    store.set('spam_mode_channel_id', SPAM_CHANNEL_ID);

    mockDatabase.getValue.mockImplementation(async (key) => {
      const values = {
        spam_mode_enabled: true,
        spam_mode_window_hours: '4',
        spam_mode_threshold: '3',
        spam_mode_channel_id: SPAM_CHANNEL_ID
      };
      if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
      return store.get(key) ?? null;
    });
    mockDatabase.getSpamModeJoinTime.mockResolvedValue(joinTime);
  }

  function buildGuildWithWarnChannel() {
    const botMember = createMockMember({ id: 'bot-123' });
    botMember.permissions.has = jest.fn(() => true);
    botMember.roles.highest = createMockRole({ position: 10 });

    mockWarnChannel = {
      id: SPAM_CHANNEL_ID,
      name: 'spam-warnings',
      send: jest.fn().mockResolvedValue(true),
      permissionsFor: jest.fn().mockReturnValue({ has: () => true })
    };

    const guild = createMockGuild();
    guild.members.me = botMember;
    guild.members.fetch.mockImplementation(async (id) => {
      if (id === 'bot-123') return botMember;
      if (id === TRACKED_USER_ID) {
        const member = createMockMember({
          id: TRACKED_USER_ID,
          user: { id: TRACKED_USER_ID, username: 'spammer', tag: 'spammer#0001', bot: false }
        });
        member.timeout = jest.fn().mockResolvedValue(true);
        return member;
      }
      return null;
    });
    const generalChannel = {
      id: 'ch-1',
      name: 'general',
      messages: {
        fetch: jest.fn(async (messageId) => ({
          id: messageId,
          delete: jest.fn().mockResolvedValue(true)
        }))
      }
    };

    guild.channels.cache = new Collection([
      [SPAM_CHANNEL_ID, mockWarnChannel],
      ['ch-1', generalChannel]
    ]);
    guild.channels.fetch.mockImplementation(async (id) => {
      if (id === SPAM_CHANNEL_ID) return mockWarnChannel;
      if (id === 'ch-1') return generalChannel;
      return null;
    });

    return guild;
  }

  function buildSpamMessage(guild, messageId, createdTimestamp) {
    const author = {
      id: TRACKED_USER_ID,
      username: 'spammer',
      tag: 'spammer#0001',
      bot: false,
      send: jest.fn().mockResolvedValue(true)
    };
    const member = createMockMember({
      id: TRACKED_USER_ID,
      user: { id: TRACKED_USER_ID, username: 'spammer', tag: 'spammer#0001', bot: false }
    });
    member.timeout = jest.fn().mockResolvedValue(true);

    return createMockMessage({
      id: messageId,
      content: LONG_SPAM_CONTENT,
      createdTimestamp,
      author,
      member,
      guild,
      channel: { id: 'ch-1', name: 'general' },
      attachments: new Collection(),
      stickers: new Collection(),
      delete: jest.fn().mockResolvedValue(true)
    });
  }

  it('should detect duplicate spam across messages and post a mod warning', async () => {
    setupSpamConfig();
    const guild = buildGuildWithWarnChannel();
    const baseTs = dayjs('2025-06-01T12:00:00.000Z').valueOf();

    for (let i = 0; i < 3; i++) {
      const message = buildSpamMessage(guild, `msg-${i}`, baseTs + i * 1000);
      await messageCreateEvent.execute(message);
    }

    expect(mockWarnChannel.send).toHaveBeenCalled();
    const payload = mockWarnChannel.send.mock.calls[0][0];
    expect(payload.embeds).toBeDefined();
    expect(payload.embeds[0].data.title).toMatch(/spam/i);
  });

  it('should route spam dismiss buttons through interactionCreate', async () => {
    store.set('spam_mode_channel_id', SPAM_CHANNEL_ID);
    const guild = buildGuildWithWarnChannel();
    const mod = createMockMember({ id: 'mod-123' });
    mod.permissions.has = jest.fn((perm) => perm === PermissionFlagsBits.ModerateMembers);

    const interaction = {
      isButton: () => true,
      isAutocomplete: () => false,
      isCommand: () => false,
      customId: 'spamWarn:dismiss',
      channelId: SPAM_CHANNEL_ID,
      guild,
      member: mod,
      user: { id: 'mod-123' },
      message: { edit: jest.fn().mockResolvedValue(true) },
      deferUpdate: jest.fn().mockResolvedValue(true),
      reply: jest.fn().mockResolvedValue(true),
      client: { commands: new Collection() }
    };

    await interactionCreateEvent.execute(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.message.edit).toHaveBeenCalledWith({ components: [] });
  });
});
