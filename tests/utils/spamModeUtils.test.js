const dayjs = require('dayjs');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');

const TARGET_USER_ID = '987654321098765432';
const MOD_USER_ID = '111111111111111111';
const SPAM_CHANNEL_ID = 'warn-channel-123';
const TRACKED_USER_ID = '123456789012345678';

const LONG_SPAM_CONTENT =
  'This is a sufficiently long duplicate spam message for testing purposes here today';

const BASE_TS = dayjs('2025-06-01T12:00:00.000Z').valueOf();
const ts = (offsetMs = 0) => BASE_TS + offsetMs;

describe('spamModeUtils', () => {
  let spamModeUtils;
  let mockDatabase;
  let mockLogger;
  let mockMessage;
  let mockInteraction;
  let createMockMessage;
  let createMockButton;
  let createMockMember;
  let createMockRole;
  let createMockGuild;

  function setupDatabaseValues(overrides = {}) {
    const values = {
      spam_mode_window_hours: '4',
      spam_mode_threshold: '3',
      spam_mode_channel_id: SPAM_CHANNEL_ID,
      ...overrides
    };
    mockDatabase.getValue.mockImplementation(async (key) => {
      if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
      return null;
    });
  }

  function setupActiveUser(joinTime = dayjs().subtract(30, 'minute').toDate(), dbOverrides = {}) {
    mockDatabase.getSpamModeJoinTime.mockResolvedValue(joinTime);
    setupDatabaseValues(dbOverrides);
  }

  function createBotMember(position = 10) {
    const botMember = createMockMember({ id: 'bot-123' });
    botMember.permissions.has = jest.fn(() => true);
    botMember.roles.highest = createMockRole({ position });
    return botMember;
  }

  function wireGuildMembers(guild, botMember, targetMember) {
    guild.members.me = botMember;
    guild.members.fetch.mockImplementation(async (id) => {
      if (id === 'bot-123') return botMember;
      if (targetMember && (id === targetMember.id || id === targetMember.user?.id)) return targetMember;
      return null;
    });
  }

  function setupWarnChannel(guild) {
    const mockWarnChannel = {
      id: SPAM_CHANNEL_ID,
      name: 'spam-warnings',
      send: jest.fn().mockResolvedValue(true),
      permissionsFor: jest.fn().mockReturnValue({ has: () => true })
    };
    const priorImpl = guild.channels.fetch.getMockImplementation();
    guild.channels.fetch.mockImplementation(async (id) => {
      if (id === SPAM_CHANNEL_ID) return mockWarnChannel;
      if (priorImpl) return priorImpl(id);
      return guild.channels.cache.get(id) ?? null;
    });
    return mockWarnChannel;
  }

  function buildTrackedMessage({
    content = LONG_SPAM_CONTENT,
    messageId,
    channelId = 'ch-1',
    channelName = 'general',
    createdTimestamp = Date.now(),
    authorOverrides = {}
  } = {}) {
    const id = messageId ?? `msg-${channelId}-${createdTimestamp}`;
    const author = {
      id: TRACKED_USER_ID,
      username: 'spammer',
      tag: 'spammer#0001',
      bot: false,
      send: jest.fn().mockResolvedValue(true),
      ...authorOverrides
    };
    const member = createMockMember({
      id: TRACKED_USER_ID,
      user: { id: TRACKED_USER_ID, username: author.username, tag: author.tag, bot: false }
    });
    member.timeout = jest.fn().mockResolvedValue(true);
    const msg = createMockMessage({
      id,
      content,
      createdTimestamp,
      author,
      member,
      channel: { id: channelId, name: channelName }
    });
    msg.delete = jest.fn().mockResolvedValue(true);
    return msg;
  }

  function setupChannelFetch(guild, messageById) {
    const channels = new Map();
    for (const [channelId, cfg] of Object.entries(messageById)) {
      const channel = {
        id: channelId,
        name: cfg.name ?? channelId,
        messages: {
          fetch: jest.fn(async (mid) => cfg.messages[mid] ?? null)
        }
      };
      channels.set(channelId, channel);
    }
    guild.channels.cache = channels;
    guild.channels.fetch.mockImplementation(async (id) => channels.get(id) ?? null);
  }

  async function triggerDuplicateSpam(messages, guild, channelConfig, options = {}) {
    const botMember = createBotMember();
    wireGuildMembers(guild, botMember, messages[0].member);
    if (channelConfig) setupChannelFetch(guild, channelConfig);
    let warn = null;
    if (options.warnChannelMissing) {
      const priorImpl = guild.channels.fetch.getMockImplementation();
      guild.channels.fetch.mockImplementation(async (id) => {
        if (id === SPAM_CHANNEL_ID) return null;
        if (priorImpl) return priorImpl(id);
        return guild.channels.cache.get(id) ?? null;
      });
    } else {
      warn = setupWarnChannel(guild);
      if (options.configureWarn) options.configureWarn(warn);
    }

    const sharedMember = messages[0].member;
    if (!jest.isMockFunction(sharedMember.timeout)) {
      sharedMember.timeout = jest.fn().mockResolvedValue(true);
    }

    for (const msg of messages) {
      msg.guild = guild;
      msg.member = sharedMember;
      await spamModeUtils.trackNewUserMessage(msg);
    }
    return warn;
  }

  function setupSpamButtonInteraction(customId, options = {}) {
    const {
      channelId = SPAM_CHANNEL_ID,
      moderatorPerms = [PermissionFlagsBits.ModerateMembers],
      botPerms = [PermissionFlagsBits.ModerateMembers],
      targetMember = null,
      guild = null,
      botMember = null
    } = options;

    mockInteraction.customId = customId;
    mockInteraction.isButton.mockReturnValue(true);
    mockInteraction.channelId = channelId;
    mockInteraction.deferred = false;
    mockInteraction.replied = false;
    mockInteraction.message = { edit: jest.fn().mockResolvedValue(true) };
    mockInteraction.followUp = jest.fn().mockResolvedValue(true);
    mockInteraction.user = { id: MOD_USER_ID, tag: 'mod#0001' };

    if (guild) {
      mockInteraction.guild = guild;
      const bot = botMember ?? createBotMember();
      bot.permissions.has = jest.fn((p) => botPerms.includes(p));
      guild.members.me = bot;
      guild.members.ban = jest.fn().mockResolvedValue(true);
      guild.ownerId = 'owner-999';

      const mod = createMockMember({ id: MOD_USER_ID });
      mod.permissions.has = jest.fn((p) => moderatorPerms.includes(p));
      mod.roles.highest = createMockRole({ position: 5 });
      mockInteraction.member = mod;

      if (targetMember) {
        targetMember.roles.highest = targetMember.roles.highest ?? createMockRole({ position: 1 });
        guild.members.fetch.mockImplementation(async (id) => {
          if (id === 'bot-123') return bot;
          if (id === targetMember.id) return targetMember;
          return null;
        });
      } else {
        guild.members.fetch.mockImplementation(async (id) => {
          if (id === 'bot-123') return bot;
          return null;
        });
      }
    }

    mockDatabase.getValue.mockResolvedValue(SPAM_CHANNEL_ID);
  }

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({}));

    mockDatabase = {
      getSpamModeJoinTime: jest.fn(),
      removeSpamModeJoinTime: jest.fn(),
      getValue: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    ({
      createMockMessage,
      createMockButton,
      createMockMember,
      createMockRole,
      createMockGuild
    } = require('../../tests/testUtils'));

    mockMessage = buildTrackedMessage();
    mockInteraction = createMockButton();

    const botMember = createBotMember();
    wireGuildMembers(mockMessage.guild, botMember, mockMessage.member);
    mockInteraction.guild = mockMessage.guild;
    mockInteraction.member = mockMessage.member;

    spamModeUtils = require('../../utils/spamModeUtils');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('trackNewUserMessage', () => {
    it('should ignore users not in spam mode', async () => {
      mockDatabase.getSpamModeJoinTime.mockResolvedValue(null);
      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.removeSpamModeJoinTime).not.toHaveBeenCalled();
    });

    it('should remove users who are past their window', async () => {
      mockDatabase.getSpamModeJoinTime.mockResolvedValue(
        dayjs('2025-06-01T12:00:00.000Z').subtract(5, 'hour').toDate()
      );
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_window_hours') return '4';
        return null;
      });

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.removeSpamModeJoinTime).toHaveBeenCalledWith(mockMessage.author.id);
    });

    it('should fall back to mute_mode_kick_time_hours when spam window is unset', async () => {
      mockDatabase.getSpamModeJoinTime.mockResolvedValue(new Date());
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_window_hours') return null;
        if (key === 'mute_mode_kick_time_hours') return '2';
        if (key === 'spam_mode_threshold') return '3';
        return null;
      });

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.getValue).toHaveBeenCalledWith('mute_mode_kick_time_hours');
    });

    it('should ignore slash commands', async () => {
      setupActiveUser();
      mockMessage.content = '/help';

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockMessage.delete).not.toHaveBeenCalled();
    });

    it('should skip sticker-only messages', async () => {
      setupActiveUser();
      mockMessage.content = '';
      mockMessage.stickers = { size: 1 };

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.getValue).not.toHaveBeenCalledWith('spam_mode_threshold');
    });

    it('should skip emote-only messages', async () => {
      setupActiveUser();
      mockMessage.content = '<:testemote:123456789012345678>';
      mockMessage.stickers = { size: 0 };

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockMessage.delete).not.toHaveBeenCalled();
    });

    it('should skip short non-link messages', async () => {
      setupActiveUser();
      mockMessage.content = 'hi';

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockMessage.delete).not.toHaveBeenCalled();
    });

    it('should skip messages that are too short after normalization', async () => {
      setupActiveUser();
      mockMessage.content = '  a  ';

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockMessage.delete).not.toHaveBeenCalled();
    });

    it('should skip non-sentence-length messages with few words', async () => {
      setupActiveUser();
      mockMessage.content = 'one two three four';

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockMessage.delete).not.toHaveBeenCalled();
    });

    it('should track messages and detect exact duplicate spam', async () => {
      setupActiveUser();
      const guild = mockMessage.guild;
      const member = mockMessage.member;
      member.timeout = jest.fn().mockResolvedValue(true);

      const m1 = buildTrackedMessage({ messageId: 'dup-1', createdTimestamp: ts(0) });
      const m2 = buildTrackedMessage({ messageId: 'dup-2', createdTimestamp: ts(1000) });
      const m3 = buildTrackedMessage({ messageId: 'dup-3', createdTimestamp: ts(2000) });

      const warnChannel = await triggerDuplicateSpam([m1, m2, m3], guild, {
        'ch-1': {
          messages: {
            'dup-1': { id: 'dup-1', delete: jest.fn().mockResolvedValue(true) },
            'dup-2': { id: 'dup-2', delete: jest.fn().mockResolvedValue(true) },
            'dup-3': m3
          }
        }
      });

      expect(m3.delete).toHaveBeenCalled();
      expect(m1.member.timeout).toHaveBeenCalledWith(600000, 'Spam detected: duplicate or similar messages');
      expect(warnChannel.send).toHaveBeenCalled();
      expect(m3.author.send).toHaveBeenCalled();
    });

    it('should detect similar (not identical) duplicate content', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      const botMember = createBotMember();
      wireGuildMembers(guild, botMember, member);
      setupWarnChannel(guild);

      const base = LONG_SPAM_CONTENT;
      const variant = base.replace('here today', 'here today!');

      const m1 = buildTrackedMessage({ content: base, messageId: 'sim-1', createdTimestamp: ts(0) });
      const m2 = buildTrackedMessage({ content: variant, messageId: 'sim-2', createdTimestamp: ts(1000) });
      const m3 = buildTrackedMessage({ content: base, messageId: 'sim-3', createdTimestamp: ts(2000) });

      setupChannelFetch(guild, {
        'ch-1': {
          messages: {
            'sim-1': { id: 'sim-1', delete: jest.fn().mockResolvedValue(true) },
            'sim-2': { id: 'sim-2', delete: jest.fn().mockResolvedValue(true) },
            'sim-3': m3
          }
        }
      });
      setupWarnChannel(guild);

      m1.guild = m2.guild = m3.guild = guild;
      m1.member = m2.member = m3.member = member;

      await spamModeUtils.trackNewUserMessage(m1);
      await spamModeUtils.trackNewUserMessage(m2);
      await spamModeUtils.trackNewUserMessage(m3);

      expect(m3.delete).toHaveBeenCalled();
      expect(member.timeout).toHaveBeenCalled();
    });

    it('should trigger spam sooner for discord.gg invite links', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);

      const linkContent = 'join us at discord.gg/testinvite now please';
      const m1 = buildTrackedMessage({ content: linkContent, messageId: 'link-1', createdTimestamp: ts(0) });
      const m2 = buildTrackedMessage({ content: linkContent, messageId: 'link-2', createdTimestamp: ts(1000) });

      setupChannelFetch(guild, {
        'ch-1': {
          messages: {
            'link-1': { id: 'link-1', delete: jest.fn().mockResolvedValue(true) },
            'link-2': m2
          }
        }
      });
      setupWarnChannel(guild);

      m1.guild = m2.guild = guild;
      m1.member = m2.member = member;

      await spamModeUtils.trackNewUserMessage(m1);
      await spamModeUtils.trackNewUserMessage(m2);

      expect(m2.delete).toHaveBeenCalled();
      expect(member.timeout).toHaveBeenCalled();
    });

    it('should trigger spam sooner when duplicates span multiple channels', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);

      const m1 = buildTrackedMessage({
        messageId: 'mc-1',
        channelId: 'ch-a',
        channelName: 'alpha',
        createdTimestamp: ts(0)
      });
      const m2 = buildTrackedMessage({
        messageId: 'mc-2',
        channelId: 'ch-b',
        channelName: 'beta',
        createdTimestamp: ts(1000)
      });

      setupChannelFetch(guild, {
        'ch-a': { name: 'alpha', messages: { 'mc-1': { id: 'mc-1', delete: jest.fn().mockResolvedValue(true) } } },
        'ch-b': { name: 'beta', messages: { 'mc-2': m2 } }
      });
      setupWarnChannel(guild);

      m1.guild = m2.guild = guild;
      m1.member = m2.member = member;

      await spamModeUtils.trackNewUserMessage(m1);
      await spamModeUtils.trackNewUserMessage(m2);

      expect(m2.delete).toHaveBeenCalled();
      expect(member.timeout).toHaveBeenCalled();
    });

    it('should record DM failure when user cannot be messaged', async () => {
      setupActiveUser();
      const guild = mockMessage.guild;
      const member = mockMessage.member;
      member.timeout = jest.fn().mockResolvedValue(true);

      const m1 = buildTrackedMessage({
        messageId: 'dm-1',
        createdTimestamp: ts(0),
        authorOverrides: { send: jest.fn().mockRejectedValue(new Error('Cannot DM')) }
      });
      const m2 = buildTrackedMessage({ messageId: 'dm-2', createdTimestamp: ts(1000), authorOverrides: m1.author });
      const m3 = buildTrackedMessage({ messageId: 'dm-3', createdTimestamp: ts(2000), authorOverrides: m1.author });

      const warn = await triggerDuplicateSpam([m1, m2, m3], guild, {
        'ch-1': {
          messages: {
            'dm-1': { id: 'dm-1', delete: jest.fn().mockResolvedValue(true) },
            'dm-2': { id: 'dm-2', delete: jest.fn().mockResolvedValue(true) },
            'dm-3': m3
          }
        }
      });

      expect(m1.author.send).toHaveBeenCalled();
      const payload = warn.send.mock.calls[0][0];
      const embed = payload.embeds[0];
      const fields = embed.data?.fields ?? embed.fields ?? [];
      const dmField = fields.find((f) => f.name === 'DM notification');
      expect(dmField.value).toContain('Failed');
    });

    it('should tolerate deleteOffendingMessages fetch and delete failures', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);

      const m1 = buildTrackedMessage({ messageId: 'fail-1', channelId: 'ch-ok', createdTimestamp: ts(0) });
      const m2 = buildTrackedMessage({ messageId: 'fail-2', channelId: 'ch-ok', createdTimestamp: ts(1000) });
      const m3 = buildTrackedMessage({ messageId: 'fail-3', channelId: 'ch-ok', createdTimestamp: ts(2000) });

      const throwingDelete = {
        id: 'fail-2',
        delete: jest.fn().mockRejectedValue(new Error('no perms'))
      };

      setupChannelFetch(guild, {
        'ch-ok': {
          messages: {
            'fail-1': { id: 'fail-1', delete: jest.fn().mockResolvedValue(true) },
            'fail-2': throwingDelete,
            'fail-3': m3
          }
        }
      });
      setupWarnChannel(guild);

      m1.guild = m2.guild = m3.guild = guild;
      m1.member = m2.member = m3.member = member;

      await spamModeUtils.trackNewUserMessage(m1);
      await spamModeUtils.trackNewUserMessage(m2);
      await spamModeUtils.trackNewUserMessage(m3);

      expect(m3.delete).toHaveBeenCalled();
      expect(member.timeout).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should prune stale in-memory occurrences outside the tracking window', async () => {
      setupActiveUser();
      const guild = mockMessage.guild;
      setupWarnChannel(guild);

      const oldTs = dayjs().subtract(5, 'hour').valueOf();
      const mOld = buildTrackedMessage({ messageId: 'old-1', createdTimestamp: oldTs });
      setupChannelFetch(guild, { 'ch-1': { messages: { 'old-1': { id: 'old-1', delete: jest.fn() } } } });
      mOld.guild = guild;
      mOld.member = mockMessage.member;

      await spamModeUtils.trackNewUserMessage(mOld);

      const mNew = buildTrackedMessage({ messageId: 'new-1', createdTimestamp: Date.now() });
      mNew.guild = guild;
      mNew.member = mockMessage.member;
      await spamModeUtils.trackNewUserMessage(mNew);

      expect(mockMessage.delete).not.toHaveBeenCalled();
    });

    it('should skip http URL link messages without length filter', async () => {
      setupActiveUser();
      mockMessage.content = 'see https://example.com/path';

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.getValue).toHaveBeenCalledWith('spam_mode_threshold');
    });

    it('should not post warning when spam channel is missing', async () => {
      setupActiveUser(dayjs().subtract(30, 'minute').toDate(), { spam_mode_channel_id: null });
      const guild = mockMessage.guild;
      const member = mockMessage.member;
      member.timeout = jest.fn().mockResolvedValue(true);

      const messages = ['nw-1', 'nw-2', 'nw-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      await triggerDuplicateSpam(messages, guild, {
        'ch-1': {
          messages: Object.fromEntries(
            messages.map((m, i) => [
              m.id,
              i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
            ])
          )
        }
      });
      expect(messages[0].member.timeout).toHaveBeenCalled();
    });

    it('should handle warning channel without permissions', async () => {
      setupActiveUser();
      const guild = mockMessage.guild;
      const member = mockMessage.member;
      member.timeout = jest.fn().mockResolvedValue(true);

      const messages = ['perm-1', 'perm-2', 'perm-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      const warn = await triggerDuplicateSpam(
        messages,
        guild,
        {
          'ch-1': {
            messages: Object.fromEntries(
              messages.map((m, i) => [
                m.id,
                i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
              ])
            )
          }
        },
        { configureWarn: (w) => w.permissionsFor.mockReturnValue({ has: () => false }) }
      );
      expect(warn.send).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Bot lacks permissions to send messages in warning channel.',
        expect.any(Object)
      );
    });

    it('should skip timeout when member is missing or bot lacks permission', async () => {
      setupActiveUser();
      const guild = mockMessage.guild;
      setupWarnChannel(guild);
      const botMember = createBotMember();
      botMember.permissions.has = jest.fn(() => false);
      wireGuildMembers(guild, botMember, null);
      guild.members.fetch.mockResolvedValue(null);

      const messages = ['to-1', 'to-2', 'to-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      await triggerDuplicateSpam(messages, guild, {
        'ch-1': {
          messages: Object.fromEntries(
            messages.map((m, i) => [
              m.id,
              i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
            ])
          )
        }
      });
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should log and swallow top-level tracking errors', async () => {
      mockDatabase.getSpamModeJoinTime.mockRejectedValue(new Error('db down'));
      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while tracking new user message for spam mode.',
        expect.objectContaining({ err: expect.any(Error) })
      );
    });

    it('should include truncated previews in mod summary for long content', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);

      const longContent = `${'word '.repeat(80)}end`;
      const msgs = [1, 2, 3].map((n) =>
        buildTrackedMessage({
          content: longContent,
          messageId: `long-${n}`,
          createdTimestamp: ts(n * 1000)
        })
      );

      const warn = await triggerDuplicateSpam(msgs, guild, {
        'ch-1': {
          messages: Object.fromEntries(
            msgs.map((m, i) => [
              m.id,
              i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
            ])
          )
        }
      });
      const payload = warn.send.mock.calls[0][0];
      const embed = payload.embeds[0];
      const fields = embed.data?.fields ?? embed.fields ?? [];
      const summaryField = fields.find((f) => f.name === 'Messages removed (by channel)');
      expect(summaryField.value.length).toBeGreaterThan(0);
    });

    it('should skip tracking when normalized content is under three characters', async () => {
      setupActiveUser();
      mockMessage.content = '  xy  ';

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.getValue).not.toHaveBeenCalledWith('spam_mode_threshold');
    });

    it('should skip when trimmed content is under three characters', async () => {
      setupActiveUser();
      mockMessage.content = 'ab';

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.getValue).not.toHaveBeenCalledWith('spam_mode_threshold');
    });

    it('should truncate mod summary when many duplicate messages are removed', async () => {
      setupActiveUser(dayjs().subtract(30, 'minute').toDate(), { spam_mode_threshold: '12' });
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);

      const chunk = `${'spamword '.repeat(12)}end`;
      const msgs = Array.from({ length: 12 }, (_, i) =>
        buildTrackedMessage({
          content: chunk,
          messageId: `bulk-${i}`,
          createdTimestamp: ts(i * 1000)
        })
      );

      const store = Object.fromEntries(
        msgs.map((m, i) => [
          m.id,
          i < msgs.length - 1 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
        ])
      );

      const warn = await triggerDuplicateSpam(msgs, guild, { 'ch-1': { messages: store } });
      const payload = warn.send.mock.calls[0][0];
      const embed = payload.embeds[0];
      const fields = embed.data?.fields ?? embed.fields ?? [];
      const summaryField = fields.find((f) => f.name === 'Messages removed (by channel)');
      expect(summaryField.value).toContain('summary truncated');
    });

    it('should log when most-recent spam message delete fails', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);

      const msgs = [1, 2, 3].map((n) =>
        buildTrackedMessage({ messageId: `del-${n}`, createdTimestamp: ts(n * 1000) })
      );
      msgs[2].delete.mockRejectedValue(new Error('already deleted'));

      await triggerDuplicateSpam(msgs, guild, {
        'ch-1': {
          messages: Object.fromEntries(
            msgs.map((m, i) => [
              m.id,
              i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
            ])
          )
        }
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Could not delete most-recent spam message (may already be gone).',
        expect.objectContaining({ messageId: msgs[2].id })
      );
    });

    it('should handle missing channel and message during deletion', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);

      const m1 = buildTrackedMessage({ messageId: 'nf-1', channelId: 'ch-1', createdTimestamp: ts(0) });
      const m2 = buildTrackedMessage({ messageId: 'nf-2', channelId: 'ch-1', createdTimestamp: ts(1000) });
      const m3 = buildTrackedMessage({ messageId: 'nf-3', channelId: 'ch-1', createdTimestamp: ts(2000) });

      setupChannelFetch(guild, {
        'ch-1': {
          messages: {
            'nf-2': null,
            'nf-3': m3
          }
        }
      });
      setupWarnChannel(guild);

      m1.guild = m2.guild = m3.guild = guild;
      m1.member = m2.member = m3.member = member;

      await spamModeUtils.trackNewUserMessage(m1);
      await spamModeUtils.trackNewUserMessage(m2);
      await spamModeUtils.trackNewUserMessage(m3);

      expect(m3.delete).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should warn when warning channel fetch fails', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);

      const msgs = ['wc-1', 'wc-2', 'wc-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      msgs[2].delete = jest.fn().mockResolvedValue(true);

      await triggerDuplicateSpam(msgs, guild, {
        'ch-1': {
          messages: {
            'wc-1': { id: 'wc-1', delete: jest.fn().mockResolvedValue(true) },
            'wc-2': { id: 'wc-2', delete: jest.fn().mockResolvedValue(true) },
            'wc-3': msgs[2]
          }
        }
      }, {
        configureWarn: () => {},
        warnChannelMissing: true
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Warning channel not found in guild.',
        expect.any(Object)
      );
    });

    it('should log when posting spam warning throws', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const msgs = ['ps-1', 'ps-2', 'ps-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );

      await triggerDuplicateSpam(
        msgs,
        guild,
        {
          'ch-1': {
            messages: Object.fromEntries(
              msgs.map((m, i) => [
                m.id,
                i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
              ])
            )
          }
        },
        { configureWarn: (warn) => warn.send.mockRejectedValue(new Error('channel broken')) }
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while posting spam warning.',
        expect.objectContaining({ err: expect.any(Error) })
      );
    });

    it('should skip timeout when target outranks the bot', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const bot = createBotMember(1);
      const msgs = ['hr-1', 'hr-2', 'hr-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      msgs.forEach((m) => {
        m.member.roles.highest = createMockRole({ position: 99 });
      });
      wireGuildMembers(guild, bot, msgs[0].member);

      await triggerDuplicateSpam(msgs, guild, {
        'ch-1': {
          messages: Object.fromEntries(
            msgs.map((m, i) => [
              m.id,
              i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
            ])
          )
        }
      });

      expect(msgs[0].member.timeout).not.toHaveBeenCalled();
      expect(
        mockLogger.warn.mock.calls.some(
          (call) =>
            call[0] === "Cannot timeout user, user's role is higher than or equal to bot's role."
        )
      ).toBe(true);
    });

    it('should log when automatic timeout throws', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const msgs = ['te-1', 'te-2', 'te-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      msgs.forEach((m) => {
        m.member.timeout = jest.fn().mockRejectedValue(new Error('timeout failed'));
      });
      wireGuildMembers(guild, createBotMember(), msgs[0].member);

      await triggerDuplicateSpam(msgs, guild, {
        'ch-1': {
          messages: Object.fromEntries(
            msgs.map((m, i) => [
              m.id,
              i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
            ])
          )
        }
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while timing out user.',
        expect.objectContaining({ err: expect.any(Error) })
      );
    });

    it('should skip when raw length passes but normalized content is too short', async () => {
      setupActiveUser();
      const fakeContent = {
        replace: () => fakeContent,
        trim: () => fakeContent,
        startsWith: () => false,
        length: 3
      };
      mockMessage.content = fakeContent;

      await spamModeUtils.trackNewUserMessage(mockMessage);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Spam mode: Message too short (post-normalization), skipping tracking.'
      );
      expect(mockDatabase.getValue).not.toHaveBeenCalledWith('spam_mode_threshold');
    });

    it('should increment failedCount when delete channel is missing from cache and fetch', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);

      const m1 = buildTrackedMessage({ messageId: 'fc-1', channelId: 'ch-gone', createdTimestamp: ts(0) });
      const m2 = buildTrackedMessage({ messageId: 'fc-2', channelId: 'ch-gone', createdTimestamp: ts(1000) });
      const m3 = buildTrackedMessage({ messageId: 'fc-3', channelId: 'ch-1', createdTimestamp: ts(2000) });

      guild.channels.cache = new Map([
        [
          'ch-1',
          {
            id: 'ch-1',
            messages: { fetch: jest.fn(async (id) => (id === 'fc-3' ? m3 : null)) }
          }
        ]
      ]);
      guild.channels.fetch.mockImplementation(async (id) => {
        if (id === 'ch-gone') return null;
        return guild.channels.cache.get(id) ?? null;
      });

      m1.guild = m2.guild = m3.guild = guild;
      m1.member = m2.member = m3.member = member;

      await spamModeUtils.trackNewUserMessage(m1);
      await spamModeUtils.trackNewUserMessage(m2);
      await spamModeUtils.trackNewUserMessage(m3);

      expect(m3.delete).toHaveBeenCalled();
      expect(guild.channels.fetch).toHaveBeenCalledWith('ch-gone');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Deleted earlier spam messages; most recent kept for reply.',
        expect.objectContaining({ failedCount: 2 })
      );
    });

    it('should fetch most recent channel via API when not cached', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);

      const fetchedChannel = {
        id: 'ch-fetch',
        messages: { fetch: jest.fn(async (id) => (id === 'fr-3' ? { id: 'fr-3', delete: jest.fn() } : null)) }
      };
      const m1 = buildTrackedMessage({ messageId: 'fr-1', channelId: 'ch-1', createdTimestamp: ts(0) });
      const m2 = buildTrackedMessage({ messageId: 'fr-2', channelId: 'ch-1', createdTimestamp: ts(1000) });
      const m3 = buildTrackedMessage({ messageId: 'fr-3', channelId: 'ch-fetch', createdTimestamp: ts(2000) });
      m3.delete = jest.fn().mockResolvedValue(true);

      guild.channels.cache = new Map([
        [
          'ch-1',
          {
            id: 'ch-1',
            messages: {
              fetch: jest.fn(async (id) =>
                id === 'fr-1' ? { id: 'fr-1', delete: jest.fn().mockResolvedValue(true) } : null
              )
            }
          }
        ]
      ]);
      guild.channels.fetch.mockImplementation(async (id) => {
        if (id === 'ch-fetch') return fetchedChannel;
        return guild.channels.cache.get(id) ?? null;
      });

      m1.guild = m2.guild = m3.guild = guild;
      m1.member = m2.member = m3.member = member;

      await spamModeUtils.trackNewUserMessage(m1);
      await spamModeUtils.trackNewUserMessage(m2);
      await spamModeUtils.trackNewUserMessage(m3);

      expect(guild.channels.fetch).toHaveBeenCalledWith('ch-fetch');
      expect(fetchedChannel.messages.fetch).toHaveBeenCalledWith('fr-3');
    });

    it('should warn when fetching most recent message throws', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);

      const msgs = ['mr-1', 'mr-2', 'mr-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, channelId: 'ch-boom', createdTimestamp: ts(i * 1000) })
      );
      msgs[2].delete = jest.fn().mockResolvedValue(true);

      guild.channels.cache.get = jest.fn((id) => {
        if (id === 'ch-boom') throw new Error('cache read failed');
        return null;
      });
      guild.channels.fetch.mockResolvedValue(null);

      msgs.forEach((m) => {
        m.guild = guild;
        m.member = member;
      });

      await spamModeUtils.trackNewUserMessage(msgs[0]);
      await spamModeUtils.trackNewUserMessage(msgs[1]);
      await spamModeUtils.trackNewUserMessage(msgs[2]);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch most recent message.',
        expect.objectContaining({ messageId: 'mr-3' })
      );
    });

    it('should warn when guild is missing during automatic timeout', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);
      setupChannelFetch(guild, {
        'ch-1': {
          messages: {
            'ng-1': { id: 'ng-1', delete: jest.fn().mockResolvedValue(true) },
            'ng-2': { id: 'ng-2', delete: jest.fn().mockResolvedValue(true) },
            'ng-3': { id: 'ng-3', delete: jest.fn().mockResolvedValue(true) }
          }
        }
      });

      const msgs = ['ng-1', 'ng-2', 'ng-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      msgs.forEach((m) => {
        m.guild = guild;
        m.member = member;
      });

      await spamModeUtils.trackNewUserMessage(msgs[0]);
      await spamModeUtils.trackNewUserMessage(msgs[1]);
      msgs[2].guild = null;
      await spamModeUtils.trackNewUserMessage(msgs[2]);

      expect(mockLogger.warn).toHaveBeenCalledWith('Cannot timeout user: missing guild or user.');
    });

    it('should warn when member cannot be fetched for automatic timeout', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      wireGuildMembers(guild, createBotMember(), member);
      guild.members.fetch.mockImplementation(async (id) => {
        if (id === 'bot-123') return guild.members.me;
        return null;
      });
      setupWarnChannel(guild);
      setupChannelFetch(guild, {
        'ch-1': {
          messages: {
            'tm-1': { id: 'tm-1', delete: jest.fn().mockResolvedValue(true) },
            'tm-2': { id: 'tm-2', delete: jest.fn().mockResolvedValue(true) },
            'tm-3': { id: 'tm-3', delete: jest.fn().mockResolvedValue(true) }
          }
        }
      });

      const msgs = ['tm-1', 'tm-2', 'tm-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      msgs.forEach((m) => {
        m.guild = guild;
        m.member = member;
      });

      for (const msg of msgs) {
        await spamModeUtils.trackNewUserMessage(msg);
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Cannot timeout user, member not found in guild.',
        expect.objectContaining({ userId: TRACKED_USER_ID })
      );
    });

    it('should warn when bot lacks ModerateMembers for automatic timeout', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const bot = createBotMember();
      bot.permissions.has = jest.fn(() => false);
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, bot, member);
      setupWarnChannel(guild);
      setupChannelFetch(guild, {
        'ch-1': {
          messages: {
            'bp-1': { id: 'bp-1', delete: jest.fn().mockResolvedValue(true) },
            'bp-2': { id: 'bp-2', delete: jest.fn().mockResolvedValue(true) },
            'bp-3': { id: 'bp-3', delete: jest.fn().mockResolvedValue(true) }
          }
        }
      });

      const msgs = ['bp-1', 'bp-2', 'bp-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      msgs.forEach((m) => {
        m.guild = guild;
        m.member = member;
      });

      for (const msg of msgs) {
        await spamModeUtils.trackNewUserMessage(msg);
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Cannot timeout user, bot lacks ModerateMembers permission.',
        expect.objectContaining({ userId: TRACKED_USER_ID })
      );
      expect(member.timeout).not.toHaveBeenCalled();
    });

    it('should warn when automatic timeout duration is invalid', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);
      setupChannelFetch(guild, {
        'ch-1': {
          messages: {
            'iv-1': { id: 'iv-1', delete: jest.fn().mockResolvedValue(true) },
            'iv-2': { id: 'iv-2', delete: jest.fn().mockResolvedValue(true) },
            'iv-3': { id: 'iv-3', delete: jest.fn().mockResolvedValue(true) }
          }
        }
      });
      const isFiniteSpy = jest.spyOn(Number, 'isFinite').mockReturnValue(false);

      const msgs = ['iv-1', 'iv-2', 'iv-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      msgs.forEach((m) => {
        m.guild = guild;
        m.member = member;
      });

      for (const msg of msgs) {
        await spamModeUtils.trackNewUserMessage(msg);
      }

      isFiniteSpy.mockRestore();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Cannot timeout user: invalid durationSeconds',
        expect.objectContaining({ userId: TRACKED_USER_ID })
      );
    });


  });

  describe('deleteOffendingMessages', () => {
    it('should fetch missing channels and return null when channel cannot be resolved', async () => {
      const guild = createMockGuild();
      guild.channels.cache = new Map();
      guild.channels.fetch.mockResolvedValue(null);

      const result = await spamModeUtils.deleteOffendingMessages(guild, [
        { channelId: 'missing-ch', messageId: 'm-1', timestamp: 1, channelName: 'gone' },
        { channelId: 'missing-ch', messageId: 'm-2', timestamp: 2, channelName: 'gone' }
      ]);

      expect(guild.channels.fetch).toHaveBeenCalledWith('missing-ch');
      expect(result).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Deleted earlier spam messages; most recent kept for reply.',
        expect.objectContaining({ failedCount: 1 })
      );
    });

    it('should fetch the most recent channel when it is not cached', async () => {
      const guild = createMockGuild();
      const fetchedChannel = {
        messages: {
          fetch: jest.fn().mockResolvedValue({ id: 'keep-2', delete: jest.fn() })
        }
      };
      guild.channels.cache = new Map();
      guild.channels.fetch.mockResolvedValue(fetchedChannel);

      await spamModeUtils.deleteOffendingMessages(guild, [
        { channelId: 'cached-ch', messageId: 'del-1', timestamp: 1, channelName: 'cached' },
        { channelId: 'fetch-ch', messageId: 'keep-2', timestamp: 2, channelName: 'fetched' }
      ]);

      expect(guild.channels.fetch).toHaveBeenCalledWith('fetch-ch');
      expect(fetchedChannel.messages.fetch).toHaveBeenCalledWith('keep-2');
    });

    it('should warn when resolving the most recent channel throws', async () => {
      const guild = createMockGuild();
      guild.channels.cache.get = jest.fn(() => {
        throw new Error('cache read failed');
      });
      guild.channels.fetch.mockResolvedValue(null);

      await spamModeUtils.deleteOffendingMessages(guild, [
        { channelId: 'boom-ch', messageId: 'only-1', timestamp: 1, channelName: 'boom' }
      ]);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch most recent message.',
        expect.objectContaining({ messageId: 'only-1' })
      );
    });
  });

  describe('internal coverage gaps', () => {
    it('should handle channel fetch rejections in deleteOffendingMessages', async () => {
      const guild = createMockGuild();
      guild.channels.cache = new Map();
      guild.channels.fetch.mockRejectedValue(new Error('channel fetch failed'));

      await spamModeUtils.deleteOffendingMessages(guild, [
        { channelId: 'reject-ch', messageId: 'r-1', timestamp: 1, channelName: 'reject' },
        { channelId: 'reject-ch', messageId: 'r-2', timestamp: 2, channelName: 'reject' }
      ]);

      expect(guild.channels.fetch).toHaveBeenCalled();
    });

    it('should handle message fetch rejections in deleteOffendingMessages', async () => {
      const guild = createMockGuild();
      guild.channels.cache = new Map([
        [
          'ch-reject',
          {
            messages: {
              fetch: jest.fn().mockRejectedValue(new Error('message fetch failed'))
            }
          }
        ]
      ]);

      await spamModeUtils.deleteOffendingMessages(guild, [
        { channelId: 'ch-reject', messageId: 'mr-1', timestamp: 1, channelName: 'reject' },
        { channelId: 'ch-reject', messageId: 'mr-2', timestamp: 2, channelName: 'reject' }
      ]);

      expect(guild.channels.cache.get('ch-reject').messages.fetch).toHaveBeenCalled();
    });

    it('should handle most recent channel fetch rejections in deleteOffendingMessages', async () => {
      const guild = createMockGuild();
      guild.channels.cache = new Map();
      guild.channels.fetch.mockRejectedValue(new Error('recent channel fetch failed'));

      await spamModeUtils.deleteOffendingMessages(guild, [
        { channelId: 'recent-ch', messageId: 'only', timestamp: 1, channelName: 'recent' }
      ]);
    });

    it('should use plural channel labels for multi-message summaries', () => {
      const summary = spamModeUtils.formatDeletedMessagesSummary([
        {
          channelId: 'plural-ch',
          channelName: 'plural-room',
          timestamp: 1,
          messageId: 'p-1',
          contentPreview: 'one'
        },
        {
          channelId: 'plural-ch',
          channelName: 'plural-room',
          timestamp: 2,
          messageId: 'p-2',
          contentPreview: 'two'
        }
      ]);
      expect(summary).toBe('**#plural-room** · 2 messages\n• one\n• two');
    });

    it('should fall back to unknown channel names in summaries', () => {
      const summary = spamModeUtils.formatDeletedMessagesSummary([
        {
          channelId: 'no-name',
          channelName: undefined,
          timestamp: 1,
          messageId: 'n-1',
          contentPreview: 'text'
        }
      ]);
      expect(summary).toContain('**#unknown**');
    });

    it('should reject non-spam custom ids when parsing buttons', () => {
      expect(spamModeUtils.parseSpamWarnButtonId('notSpam:action:123')).toBeNull();
    });

    it('should format empty previews and summaries', () => {
      expect(spamModeUtils.truncateContentPreview('')).toBe('(empty or attachments only)');
      expect(spamModeUtils.truncateContentPreview('x'.repeat(200)).endsWith('…')).toBe(true);
      expect(spamModeUtils.formatDeletedMessagesSummary([])).toBe('_No details_');
      expect(spamModeUtils.formatDeletedMessagesSummary(null)).toBe('_No details_');
      const summary = spamModeUtils.formatDeletedMessagesSummary([
        {
          channelId: 'ch-1',
          channelName: 'general',
          timestamp: 1,
          messageId: 'm-1',
          contentPreview: null
        },
        {
          channelId: 'ch-1',
          channelName: 'general',
          timestamp: 2,
          messageId: 'm-2',
          contentPreview: '   '
        }
      ]);
      expect(summary).toContain('preview unavailable');
      const huge = spamModeUtils.formatDeletedMessagesSummary(
        Array.from({ length: 80 }, (_, i) => ({
          channelId: `ch-${i % 3}`,
          channelName: `room-${i % 3}`,
          timestamp: i,
          messageId: `m-${i}`,
          contentPreview: `${'spam '.repeat(20)}${i}`
        }))
      );
      expect(huge).toContain('summary truncated');
    });

    it('should score string similarity and find near-duplicate keys', () => {
      expect(spamModeUtils.levenshtein('', 'abc')).toBe(3);
      expect(spamModeUtils.levenshtein('abcd', '')).toBe(4);
      expect(spamModeUtils.levenshtein('same', 'same')).toBe(0);
      expect(spamModeUtils.levenshtein('muchlongertext', 'short')).toBeGreaterThan(0);
      expect(spamModeUtils.levenshtein('abcdefgh', 'ab')).toBe(6);
      expect(spamModeUtils.levenshtein('ab', 'abcdefgh')).toBe(6);
      expect(spamModeUtils.similarityScore('same', 'same')).toBe(1);
      expect(spamModeUtils.similarityScore('', '')).toBe(1);
      const tracked = new Map([
        ['hello world this is a long duplicate phrase for matching', [{ timestamp: 1 }]]
      ]);
      const match = spamModeUtils.findSimilarContent(
        tracked,
        'hello world this is a long duplicate phrase for matching!'
      );
      expect(match).toBe('hello world this is a long duplicate phrase for matching');
      expect(spamModeUtils.findSimilarContent(tracked, 'totally unrelated content')).toBeNull();
    });

    it('should use singular hour text and fallback window hours', async () => {
      setupActiveUser(dayjs().subtract(30, 'minute').toDate(), {
        spam_mode_window_hours: 'not-a-number',
        mute_mode_kick_time_hours: '1'
      });
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);

      const msgs = ['wh-1', 'wh-2', 'wh-3'].map((id) => {
        const msg = buildTrackedMessage({
          messageId: id,
          authorOverrides: { send: jest.fn().mockResolvedValue(true) }
        });
        delete msg.createdTimestamp;
        return msg;
      });

      setupChannelFetch(guild, {
        'ch-1': {
          messages: Object.fromEntries(
            msgs.map((m, i) => [
              m.id,
              i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
            ])
          )
        }
      });

      msgs.forEach((m) => {
        m.guild = guild;
        m.member = member;
      });

      for (const msg of msgs) {
        await spamModeUtils.trackNewUserMessage(msg);
      }

      expect(msgs[2].author.send).toHaveBeenCalledWith(expect.stringContaining('first **1 hour**'));
    });

    it('should format singular channel message counts', () => {
      const summary = spamModeUtils.formatDeletedMessagesSummary([
        {
          channelId: 'solo',
          channelName: 'solo-room',
          timestamp: 1,
          messageId: 'only',
          contentPreview: 'one message here'
        }
      ]);
      expect(summary).toContain('1 message');
      expect(summary).not.toContain('1 messages');

      const plural = spamModeUtils.formatDeletedMessagesSummary([
        {
          channelId: 'dup',
          channelName: 'dup-room',
          timestamp: 1,
          messageId: 'a',
          contentPreview: 'first'
        },
        {
          channelId: 'dup',
          channelName: 'dup-room',
          timestamp: 2,
          messageId: 'b',
          contentPreview: 'second'
        }
      ]);
      expect(plural).toMatch(/\*\*#dup-room\*\* · 2 messages/);
    });

    it('should default invalid config values when tracking spam', async () => {
      setupActiveUser(dayjs().subtract(30, 'minute').toDate(), {
        spam_mode_window_hours: 'bad',
        mute_mode_kick_time_hours: 'also-bad',
        spam_mode_threshold: '0'
      });
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      setupWarnChannel(guild);

      const msgs = ['cfg-1', 'cfg-2', 'cfg-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      setupChannelFetch(guild, {
        'ch-1': {
          messages: Object.fromEntries(
            msgs.map((m, i) => [
              m.id,
              i < 2 ? { id: m.id, delete: jest.fn().mockResolvedValue(true) } : m
            ])
          )
        }
      });
      msgs.forEach((m) => {
        m.guild = guild;
        m.member = member;
      });

      for (const msg of msgs) {
        await spamModeUtils.trackNewUserMessage(msg);
      }

      expect(member.timeout).toHaveBeenCalled();
    });

    it('should no-op postSpamWarning without a guild', async () => {
      await spamModeUtils.postSpamWarning(null, { id: TRACKED_USER_ID, tag: 'x#0' }, [], false);
      expect(mockDatabase.getValue).not.toHaveBeenCalled();
    });

    it('should default dmSent to false when posting spam warnings', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const warn = setupWarnChannel(guild);
      mockDatabase.getValue.mockResolvedValue(SPAM_CHANNEL_ID);

      await spamModeUtils.postSpamWarning(guild, { id: TRACKED_USER_ID, tag: 'spammer#0001' }, [
        {
          channelId: 'ch-1',
          channelName: 'general',
          timestamp: 1,
          messageId: 'd-1',
          contentPreview: 'hello'
        }
      ]);

      expect(warn.send).toHaveBeenCalled();
    });

    it('should log when postSpamWarning throws unexpectedly', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const warn = setupWarnChannel(guild);
      warn.send.mockRejectedValue(new Error('send exploded'));
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_channel_id') return SPAM_CHANNEL_ID;
        return null;
      });

      await spamModeUtils.postSpamWarning(
        guild,
        { id: TRACKED_USER_ID, tag: 'spammer#0001' },
        [
          {
            channelId: 'ch-1',
            channelName: 'general',
            timestamp: 1,
            messageId: 'e-1',
            contentPreview: 'x'
          }
        ],
        true
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while posting spam warning.',
        expect.any(Object)
      );
    });

    it('should post spam warning when warn channel fetch rejects', async () => {
      setupActiveUser();
      const guild = createMockGuild();
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(), member);
      guild.channels.fetch.mockRejectedValue(new Error('warn channel down'));

      const msgs = ['pw-1', 'pw-2', 'pw-3'].map((id, i) =>
        buildTrackedMessage({ messageId: id, createdTimestamp: ts(i * 1000) })
      );
      msgs.forEach((m) => {
        m.guild = guild;
        m.member = member;
      });

      for (const msg of msgs) {
        await spamModeUtils.trackNewUserMessage(msg);
      }

      expect(guild.channels.fetch).toHaveBeenCalled();
    });

    it('should ignore invalid spam alert reply rejection', async () => {
      mockInteraction.customId = 'spamWarn:bad';
      mockInteraction.isButton.mockReturnValue(true);
      mockInteraction.reply.mockRejectedValue(new Error('reply failed'));

      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(true);
    });

    it('should handle target member fetch rejection on spam buttons', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, { guild });
      guild.members.fetch.mockRejectedValue(new Error('member fetch failed'));

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Member not found') })
      );
    });

    it('should use unknown error text when timeout fails without a message', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.timeout = jest.fn().mockRejectedValue({});
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, {
        guild,
        targetMember: target
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Failed to timeout: unknown error' })
      );
    });

    it('should swallow timeout failure reply rejection', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.timeout = jest.fn().mockRejectedValue(new Error('timeout blocked'));
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, {
        guild,
        targetMember: target
      });
      mockInteraction.reply.mockImplementation(() => ({
        catch: (onCatch) => {
          onCatch();
          return Promise.resolve();
        }
      }));

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockLogger.error).toHaveBeenCalledWith('Spam alert timeout failed.', expect.any(Object));
    });

    it('should use unknown error text when kick fails without a message', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.kick = jest.fn().mockRejectedValue({});
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.KickMembers],
        botPerms: [PermissionFlagsBits.KickMembers]
      });
      mockInteraction.deferUpdate.mockImplementation(async () => {
        mockInteraction.deferred = true;
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Failed to kick: unknown error' })
      );
    });

    it('should use unknown error text when ban fails without a message', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        targetMember: null,
        moderatorPerms: [PermissionFlagsBits.BanMembers],
        botPerms: [PermissionFlagsBits.BanMembers]
      });
      guild.members.ban.mockRejectedValue({});
      mockInteraction.deferUpdate.mockImplementation(async () => {
        mockInteraction.deferred = true;
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Failed to ban: unknown error' })
      );
    });

    it('should swallow ban message edit rejection', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        targetMember: null,
        moderatorPerms: [PermissionFlagsBits.BanMembers],
        botPerms: [PermissionFlagsBits.BanMembers]
      });
      mockInteraction.deferUpdate.mockImplementation(async () => {
        mockInteraction.deferred = true;
      });
      mockInteraction.message.edit.mockRejectedValue(new Error('edit blocked'));

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(guild.members.ban).toHaveBeenCalled();
    });

    it('should handle member fetch rejection in timeoutUser', async () => {
      const guild = createMockGuild();
      const user = { id: TRACKED_USER_ID, tag: 'spammer#0001' };
      wireGuildMembers(guild, createBotMember(10), createMockMember({ id: TRACKED_USER_ID }));
      guild.members.fetch.mockRejectedValue(new Error('member fetch failed'));

      await spamModeUtils.timeoutUser(guild, user, 600);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Cannot timeout user, member not found in guild.',
        expect.objectContaining({ userId: TRACKED_USER_ID })
      );
    });
  });

  describe('timeoutUser', () => {
    it('should warn when guild or user is missing', async () => {
      await spamModeUtils.timeoutUser(null, { id: TRACKED_USER_ID });
      expect(mockLogger.warn).toHaveBeenCalledWith('Cannot timeout user: missing guild or user.');
    });

    it('should warn when automatic timeout end date is invalid', async () => {
      const actualDayjs = jest.requireActual('dayjs');
      const originalAdd = actualDayjs.prototype.add;
      jest.resetModules();
      jest.doMock('dayjs', () => {
        const lib = (...args) => actualDayjs(...args);
        Object.assign(lib, actualDayjs);
        lib.prototype = actualDayjs.prototype;
        lib.prototype.add = function (value, unit) {
          if (unit === 'millisecond' && value === 600000) {
            return actualDayjs('not-a-real-date');
          }
          return originalAdd.call(this, value, unit);
        };
        return lib;
      });
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../config', () => ({}));
      jest.doMock('../../utils/database', () => mockDatabase);
      const utils = require('../../utils/spamModeUtils');

      const guild = createMockGuild();
      const user = { id: TRACKED_USER_ID, tag: 'spammer#0001' };
      const member = createMockMember({ id: TRACKED_USER_ID });
      member.roles.highest = createMockRole({ position: 1 });
      member.timeout = jest.fn().mockResolvedValue(true);
      wireGuildMembers(guild, createBotMember(10), member);

      await utils.timeoutUser(guild, user, 600);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Cannot timeout user: invalid calculated end date',
        expect.objectContaining({ userId: TRACKED_USER_ID })
      );
      expect(member.timeout).not.toHaveBeenCalled();
    });
  });

  describe('handleSpamWarningButton', () => {
    it('should ignore non-spam buttons', async () => {
      mockInteraction.customId = 'other:button';
      mockInteraction.isButton.mockReturnValue(true);
      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(false);
    });

    it('should ignore when interaction is not a button', async () => {
      mockInteraction.customId = 'spamWarn:dismiss';
      mockInteraction.isButton.mockReturnValue(false);
      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(false);
    });

    it('should reply for invalid spam alert customId', async () => {
      mockInteraction.customId = 'spamWarn:bad';
      mockInteraction.isButton.mockReturnValue(true);

      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(true);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Invalid spam alert control.',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should reject spam alert ids without an action segment', async () => {
      mockInteraction.customId = 'spamWarn:';
      mockInteraction.isButton.mockReturnValue(true);

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Invalid spam alert control.',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should reject malformed target user id in button customId', async () => {
      mockInteraction.customId = 'spamWarn:kick:not-a-snowflake';
      mockInteraction.isButton.mockReturnValue(true);

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Invalid spam alert control.',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should reply with error if not in configured channel', async () => {
      setupSpamButtonInteraction('spamWarn:dismiss', { channelId: 'wrong-channel' });

      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(true);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('These controls only work on spam alerts')
        })
      );
    });

    it('should reject when used outside a guild', async () => {
      setupSpamButtonInteraction('spamWarn:dismiss');
      mockInteraction.guild = null;

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'This can only be used in a server.',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should reject when member permissions cannot be verified', async () => {
      setupSpamButtonInteraction('spamWarn:dismiss');
      mockInteraction.member = { permissions: {} };

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Could not verify your permissions.',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should reject dismiss without Moderate Members permission', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction('spamWarn:dismiss', {
        guild,
        moderatorPerms: []
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Moderate Members') })
      );
    });

    it('should allow dismissal by moderator', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction('spamWarn:dismiss', { guild });

      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(true);
      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockInteraction.message.edit).toHaveBeenCalledWith({ components: [] });
    });

    it('should warn when dismiss cannot remove buttons', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction('spamWarn:dismiss', { guild });
      mockInteraction.message.edit.mockRejectedValue(new Error('edit failed'));

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Could not remove spam alert buttons.',
        expect.any(Object)
      );
    });

    it('should reject timeout when bot member is unavailable', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, { guild });
      guild.members.me = null;

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Bot member not available.',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should timeout target member for one hour', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.timeout = jest.fn().mockResolvedValue(true);
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.ModerateMembers],
        botPerms: [PermissionFlagsBits.ModerateMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(target.timeout).toHaveBeenCalledWith(
        60 * 60 * 1000,
        expect.stringContaining('Spam alert')
      );
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Timed out') })
      );
    });

    it('should report timeout failure', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.timeout = jest.fn().mockRejectedValue(new Error('timeout blocked'));
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, {
        guild,
        targetMember: target
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed to timeout') })
      );
      expect(mockLogger.error).toHaveBeenCalledWith('Spam alert timeout failed.', expect.any(Object));
    });

    it('should reject timeout for missing target member', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, { guild, targetMember: null });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Member not found') })
      );
    });

    it('should reject timeout when bot lacks Moderate Members', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 1 });
      const bot = createBotMember(10);
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        botMember: bot
      });
      guild.members.me.permissions.has = jest.fn((p) => p !== PermissionFlagsBits.ModerateMembers);

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('bot lacks') })
      );
    });

    it('should reject timeout when moderator lacks permission', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: []
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Moderate Members') })
      );
    });

    it('should reject timeout when bot role is too low', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 99 });
      const bot = createBotMember(1);
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        botMember: bot
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('role hierarchy') })
      );
    });

    it('should reject timeout when moderator role is too low', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 8 });
      const bot = createBotMember(20);
      setupSpamButtonInteraction(`spamWarn:timeout1h:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        botMember: bot
      });
      mockInteraction.member.roles.highest = createMockRole({ position: 1 });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('You cannot timeout') })
      );
    });

    it('should reject kick when target member is gone', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: null,
        moderatorPerms: [PermissionFlagsBits.KickMembers],
        botPerms: [PermissionFlagsBits.KickMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Member not found') })
      );
    });

    it('should reject kick when bot is outranked', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 50 });
      const bot = createBotMember(1);
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        botMember: bot,
        moderatorPerms: [PermissionFlagsBits.KickMembers],
        botPerms: [PermissionFlagsBits.KickMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Cannot kick') })
      );
    });

    it('should reject kick when moderator lacks Kick Members', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: []
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Kick Members') })
      );
    });

    it('should reject kick when bot lacks Kick Members', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 1 });
      const bot = createBotMember(10);
      bot.permissions.has = jest.fn((p) => p !== PermissionFlagsBits.KickMembers);
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        botMember: bot,
        moderatorPerms: [PermissionFlagsBits.KickMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('bot lacks') })
      );
    });

    it('should reject kick when moderator is outranked', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 8 });
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.KickMembers],
        botPerms: [PermissionFlagsBits.KickMembers]
      });
      mockInteraction.member.roles.highest = createMockRole({ position: 1 });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('You cannot kick') })
      );
    });

    it('should kick target member', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.kick = jest.fn().mockResolvedValue(true);
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.KickMembers],
        botPerms: [PermissionFlagsBits.KickMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(target.kick).toHaveBeenCalled();
      expect(mockInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Kicked') })
      );
    });

    it('should report kick failure', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.kick = jest.fn().mockRejectedValue(new Error('kick denied'));
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.KickMembers],
        botPerms: [PermissionFlagsBits.KickMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed to kick') })
      );
    });

    it('should reject ban when bot lacks Ban Members', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        moderatorPerms: [PermissionFlagsBits.BanMembers],
        botPerms: [PermissionFlagsBits.BanMembers]
      });
      guild.members.me.permissions.has = jest.fn((p) => p !== PermissionFlagsBits.BanMembers);

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('bot lacks') })
      );
    });

    it('should reject ban when moderator lacks Ban Members', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        moderatorPerms: []
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Ban Members') })
      );
    });

    it('should reject ban when moderator is outranked by present member', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 8 });
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.BanMembers],
        botPerms: [PermissionFlagsBits.BanMembers]
      });
      mockInteraction.member.roles.highest = createMockRole({ position: 1 });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('You cannot ban') })
      );
    });

    it('should ban by user id when target member is not in guild', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        targetMember: null,
        moderatorPerms: [PermissionFlagsBits.BanMembers],
        botPerms: [PermissionFlagsBits.BanMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(guild.members.ban).toHaveBeenCalledWith(
        TARGET_USER_ID,
        expect.objectContaining({ deleteMessageSeconds: 0 })
      );
      expect(mockInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Banned user') })
      );
    });

    it('should ban present member after hierarchy checks', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.BanMembers],
        botPerms: [PermissionFlagsBits.BanMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(guild.members.ban).toHaveBeenCalled();
    });

    it('should reject ban when bot role is too low', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.roles.highest = createMockRole({ position: 50 });
      const bot = createBotMember(1);
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        botMember: bot,
        moderatorPerms: [PermissionFlagsBits.BanMembers],
        botPerms: [PermissionFlagsBits.BanMembers]
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Cannot ban') })
      );
    });

    it('should report ban failure', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:ban:${TARGET_USER_ID}`, {
        guild,
        targetMember: null,
        moderatorPerms: [PermissionFlagsBits.BanMembers],
        botPerms: [PermissionFlagsBits.BanMembers]
      });
      guild.members.ban.mockRejectedValue(new Error('ban failed'));

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed to ban') })
      );
    });

    it('should reply unknown action for unsupported button ids', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction(`spamWarn:freeze:${TARGET_USER_ID}`, { guild });
      const target = createMockMember({ id: TARGET_USER_ID });
      guild.members.fetch.mockImplementation(async (id) => {
        if (id === TARGET_USER_ID) return target;
        return guild.members.me;
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Unknown action.',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should handle top-level errors with ephemeral reply', async () => {
      mockInteraction.customId = 'spamWarn:dismiss';
      mockInteraction.isButton.mockReturnValue(true);
      mockInteraction.channelId = SPAM_CHANNEL_ID;
      mockInteraction.guild = createMockGuild();
      mockInteraction.member = createMockMember();
      mockInteraction.member.permissions.has = jest.fn(() => true);
      mockDatabase.getValue.mockRejectedValue(new Error('db error'));

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error handling spam warning button.',
        expect.any(Object)
      );
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Something went wrong.',
        flags: MessageFlags.Ephemeral
      });
    });

    it('should follow up on top-level error when interaction was already deferred', async () => {
      const guild = createMockGuild();
      setupSpamButtonInteraction('spamWarn:dismiss', { guild });
      mockInteraction.deferred = true;
      mockInteraction.member.permissions.has = jest.fn(() => {
        throw new Error('permission check exploded');
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: 'Something went wrong.',
        flags: MessageFlags.Ephemeral
      });
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    it('should follow up when top-level error occurs after defer', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.kick = jest.fn().mockResolvedValue(true);
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.KickMembers],
        botPerms: [PermissionFlagsBits.KickMembers]
      });
      mockInteraction.deferUpdate.mockImplementation(async () => {
        mockInteraction.deferred = true;
      });
      target.kick.mockImplementation(async () => {
        throw new Error('kick exploded');
      });

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(mockInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed to kick') })
      );
    });

    it('should follow up when error occurs after defer', async () => {
      const guild = createMockGuild();
      const target = createMockMember({ id: TARGET_USER_ID });
      target.kick = jest.fn().mockResolvedValue(true);
      target.roles.highest = createMockRole({ position: 1 });
      setupSpamButtonInteraction(`spamWarn:kick:${TARGET_USER_ID}`, {
        guild,
        targetMember: target,
        moderatorPerms: [PermissionFlagsBits.KickMembers],
        botPerms: [PermissionFlagsBits.KickMembers]
      });
      mockDatabase.getValue.mockResolvedValue(SPAM_CHANNEL_ID);
      mockInteraction.deferUpdate.mockImplementation(async () => {
        mockInteraction.deferred = true;
      });
      mockInteraction.message.edit.mockRejectedValue(new Error('edit failed'));

      await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(target.kick).toHaveBeenCalled();
    });
  });
});
