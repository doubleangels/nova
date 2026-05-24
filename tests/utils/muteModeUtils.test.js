const dayjs = require('dayjs');

describe('muteModeUtils', () => {
  let muteModeUtils;
  let mockDatabase;
  let mockLogger;
  let mockClient;
  let mockGuild;
  let mockMember;
  let createMockGuild;
  let createMockMember;

  function createGuildCache(guild) {
    const cache = new Map([[guild.id, guild]]);
    cache.first = () => guild;
    return cache;
  }

  function buildClient(guild, cacheOverrides = {}) {
    const cache = createGuildCache(guild);
    Object.assign(cache, cacheOverrides);
    return {
      guilds: {
        cache,
        first: () => guild
      }
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({
      serverInviteUrl: 'http://invite.link',
      baseEmbedColor: '#ffffff'
    }));

    mockDatabase = {
      getAllMuteModeUsers: jest.fn(),
      getValue: jest.fn(),
      getUserJoinTime: jest.fn(),
      getGuildName: jest.fn().mockResolvedValue('Test Guild')
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    ({ createMockGuild, createMockMember } = require('../../tests/testUtils'));
    mockMember = createMockMember({
      id: 'user123',
      kick: jest.fn().mockResolvedValue(true),
      send: jest.fn().mockResolvedValue(true)
    });
    mockGuild = createMockGuild({ id: 'guild123' });
    mockGuild.members.fetch.mockResolvedValue(mockMember);

    mockClient = buildClient(mockGuild);

    muteModeUtils = require('../../utils/muteModeUtils');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('cancelMuteKick', () => {
    it('should return false if no timeout exists', () => {
      expect(muteModeUtils.cancelMuteKick('nonexistent')).toBe(false);
    });

    it('should return true and clear timeout if it exists', () => {
      const joinTime = new Date();
      muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');
      expect(muteModeUtils.cancelMuteKick('user123')).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Cancelled mute kick timeout for user.',
        expect.objectContaining({ userId: 'user123' })
      );
    });
  });

  describe('scheduleMuteKick', () => {
    it('should execute kick immediately if time is already up', async () => {
      const joinTime = dayjs().subtract(2, 'hour').toDate();
      mockDatabase.getUserJoinTime.mockResolvedValueOnce(joinTime);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');

      expect(mockDatabase.getUserJoinTime).toHaveBeenCalledWith('user123');
      expect(mockMember.kick).toHaveBeenCalledWith('User did not send a message in time.');
      expect(mockMember.send).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'Kicked for Inactivity',
            fields: [{ name: 'Want to rejoin?', value: expect.stringContaining('http://invite.link') }]
          })
        ]
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Kicked user (immediate).',
        expect.objectContaining({ userId: 'user123' })
      );
    });

    it('should warn and still kick when DM fails', async () => {
      const joinTime = dayjs().subtract(2, 'hour').toDate();
      mockDatabase.getUserJoinTime.mockResolvedValueOnce(joinTime);
      mockMember.send.mockRejectedValueOnce(new Error('Cannot DM'));

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to send DM to member before mute kick.',
        expect.objectContaining({ err: expect.any(Error), userTag: mockMember.user.tag })
      );
      expect(mockMember.kick).toHaveBeenCalled();
    });

    it('should skip immediate kick when user is no longer in mute mode', async () => {
      const joinTime = dayjs().subtract(2, 'hour').toDate();
      mockDatabase.getUserJoinTime.mockResolvedValueOnce(null);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'User is no longer in mute mode, skipping immediate kick.',
        expect.objectContaining({ userId: 'user123' })
      );
      expect(mockMember.kick).not.toHaveBeenCalled();
    });

    it('should skip immediate kick for bot users', async () => {
      const joinTime = dayjs().subtract(2, 'hour').toDate();
      const botMember = createMockMember({
        id: 'bot123',
        user: { id: 'bot123', tag: 'Bot#0001', bot: true },
        kick: jest.fn()
      });
      mockGuild.members.fetch.mockResolvedValueOnce(botMember);
      mockDatabase.getUserJoinTime.mockResolvedValueOnce(joinTime);

      await muteModeUtils.scheduleMuteKick('bot123', joinTime, 1, mockClient, 'guild123');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping mute kick for bot user.',
        expect.objectContaining({ userId: 'bot123' })
      );
      expect(botMember.kick).not.toHaveBeenCalled();
    });

    it('should log error when immediate kick path throws', async () => {
      const joinTime = dayjs().subtract(2, 'hour').toDate();
      mockDatabase.getUserJoinTime.mockRejectedValueOnce(new Error('db down'));

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to kick user on reschedule.',
        expect.objectContaining({ err: expect.any(Error), userId: 'user123' })
      );
    });

    it('should not kick immediately when guild is missing from cache', async () => {
      const joinTime = dayjs().subtract(2, 'hour').toDate();
      mockDatabase.getUserJoinTime.mockResolvedValueOnce(joinTime);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'missing-guild');

      expect(mockMember.kick).not.toHaveBeenCalled();
    });

    it('should not kick immediately when member fetch fails', async () => {
      const joinTime = dayjs().subtract(2, 'hour').toDate();
      mockDatabase.getUserJoinTime.mockResolvedValueOnce(joinTime);
      mockGuild.members.fetch.mockRejectedValueOnce(new Error('Unknown Member'));

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');

      expect(mockMember.kick).not.toHaveBeenCalled();
    });

    it('should schedule a kick if time is not up', async () => {
      const joinTime = new Date();
      mockDatabase.getUserJoinTime.mockResolvedValue(joinTime);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');

      expect(mockMember.kick).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Scheduled mute kick for user.',
        expect.objectContaining({ userId: 'user123', delayMinutes: expect.any(Number) })
      );

      await jest.runAllTimersAsync();

      expect(mockMember.kick).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Kicked user (timeout).',
        expect.objectContaining({ userId: 'user123' })
      );
    });

    it('should cancel an existing timeout when rescheduling', async () => {
      const joinTime = new Date();
      mockDatabase.getUserJoinTime.mockResolvedValue(joinTime);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');
      await muteModeUtils.scheduleMuteKick('user123', joinTime, 2, mockClient, 'guild123');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Cancelled mute kick timeout for user.',
        expect.objectContaining({ userId: 'user123' })
      );
    });

    it('should not kick on timeout if user is no longer in mute mode', async () => {
      const joinTime = new Date();
      mockDatabase.getUserJoinTime.mockResolvedValue(null);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');
      await jest.runAllTimersAsync();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'User is no longer in mute mode, skipping kick.',
        expect.objectContaining({ userId: 'user123' })
      );
      expect(mockMember.kick).not.toHaveBeenCalled();
    });

    it('should skip timeout kick for bot users', async () => {
      const joinTime = new Date();
      const botMember = createMockMember({
        id: 'bot123',
        user: { id: 'bot123', tag: 'Bot#0001', bot: true },
        kick: jest.fn()
      });
      mockDatabase.getUserJoinTime.mockResolvedValue(joinTime);
      mockGuild.members.fetch.mockResolvedValue(botMember);

      await muteModeUtils.scheduleMuteKick('bot123', joinTime, 1, mockClient, 'guild123');
      await jest.runAllTimersAsync();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping mute kick for bot user.',
        expect.objectContaining({ userId: 'bot123' })
      );
      expect(botMember.kick).not.toHaveBeenCalled();
    });

    it('should log error when timeout kick path throws', async () => {
      const joinTime = new Date();
      mockDatabase.getUserJoinTime.mockResolvedValue(joinTime);
      mockMember.kick.mockRejectedValueOnce(new Error('Missing Permissions'));

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');
      await jest.runAllTimersAsync();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to kick user after timeout.',
        expect.objectContaining({ err: expect.any(Error), userId: 'user123' })
      );
    });

    it('should not kick on timeout when guild is missing from cache', async () => {
      const joinTime = new Date();
      mockDatabase.getUserJoinTime.mockResolvedValue(joinTime);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'missing-guild');
      await jest.runAllTimersAsync();

      expect(mockMember.kick).not.toHaveBeenCalled();
    });

    it('should not kick on timeout when member fetch fails', async () => {
      const joinTime = new Date();
      mockDatabase.getUserJoinTime.mockResolvedValue(joinTime);
      mockGuild.members.fetch.mockRejectedValueOnce(new Error('Unknown Member'));

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');
      await jest.runAllTimersAsync();

      expect(mockMember.kick).not.toHaveBeenCalled();
    });
  });

  describe('clearAllScheduledMuteKicks', () => {
    it('should cancel all active mute kick timeouts', async () => {
      const joinTime = new Date();
      mockDatabase.getUserJoinTime.mockResolvedValue(joinTime);

      await muteModeUtils.scheduleMuteKick('user1', joinTime, 2, mockClient, 'guild123');
      await muteModeUtils.scheduleMuteKick('user2', joinTime, 2, mockClient, 'guild123');

      expect(muteModeUtils.cancelMuteKick('user1')).toBe(true);
      muteModeUtils.clearAllScheduledMuteKicks();
      expect(muteModeUtils.cancelMuteKick('user1')).toBe(false);
      expect(muteModeUtils.cancelMuteKick('user2')).toBe(false);
    });
  });

  describe('rescheduleAllMuteKicks', () => {
    it('should reschedule kicks for all users', async () => {
      mockDatabase.getValue.mockResolvedValueOnce('2');
      mockDatabase.getAllMuteModeUsers.mockResolvedValueOnce([
        { user_id: 'user1', join_time: new Date() },
        { user_id: 'user2', join_time: new Date() }
      ]);
      mockDatabase.getUserJoinTime.mockResolvedValue(new Date());

      await muteModeUtils.rescheduleAllMuteKicks(mockClient);

      expect(mockDatabase.getValue).toHaveBeenCalledWith('mute_mode_kick_time_hours');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Rescheduling mute kick for user.',
        expect.objectContaining({ userData: expect.any(String) })
      );
      expect(muteModeUtils.cancelMuteKick('user1')).toBe(true);
      expect(muteModeUtils.cancelMuteKick('user2')).toBe(true);
    });

    it('should default kick hours when config value is invalid', async () => {
      mockDatabase.getValue.mockResolvedValueOnce('not-a-number');
      mockDatabase.getAllMuteModeUsers.mockResolvedValueOnce([
        { user_id: 'user1', join_time: new Date() }
      ]);
      mockDatabase.getUserJoinTime.mockResolvedValue(new Date());

      await muteModeUtils.rescheduleAllMuteKicks(mockClient);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Scheduled mute kick for user.',
        expect.objectContaining({ userId: 'user1' })
      );
    });

    it('should do nothing if no users found', async () => {
      mockDatabase.getValue.mockResolvedValueOnce('2');
      mockDatabase.getAllMuteModeUsers.mockResolvedValueOnce([]);

      await muteModeUtils.rescheduleAllMuteKicks(mockClient);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No mute mode users found for mute kick rescheduling.'
      );
      expect(muteModeUtils.cancelMuteKick('user1')).toBe(false);
    });

    it('should do nothing when mute mode users is null', async () => {
      mockDatabase.getValue.mockResolvedValueOnce('2');
      mockDatabase.getAllMuteModeUsers.mockResolvedValueOnce(null);

      await muteModeUtils.rescheduleAllMuteKicks(mockClient);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No mute mode users found for mute kick rescheduling.'
      );
    });

    it('should return early when client is undefined', async () => {
      await muteModeUtils.rescheduleAllMuteKicks(undefined);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Discord client is undefined. Cannot reschedule mute kicks without client instance.'
      );
      expect(mockDatabase.getValue).not.toHaveBeenCalled();
    });

    it('should return early when bot is not in any guilds', async () => {
      const emptyCache = new Map();
      emptyCache.first = () => undefined;
      const emptyClient = {
        guilds: { cache: emptyCache }
      };

      await muteModeUtils.rescheduleAllMuteKicks(emptyClient);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Bot is not in any guilds; cannot reschedule mute kicks.'
      );
      expect(mockDatabase.getValue).not.toHaveBeenCalled();
    });

    it('should log error when rescheduling throws', async () => {
      mockDatabase.getValue.mockRejectedValueOnce(new Error('db unavailable'));

      await muteModeUtils.rescheduleAllMuteKicks(mockClient);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while rescheduling mute kicks on startup.',
        expect.objectContaining({ err: expect.any(Error) })
      );
    });
  });
});
