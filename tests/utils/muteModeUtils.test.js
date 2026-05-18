const dayjs = require('dayjs');

describe('muteModeUtils', () => {
  let muteModeUtils;
  let mockDatabase;
  let mockLogger;
  let mockClient;
  let mockGuild;
  let mockMember;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({ serverInviteUrl: 'http://invite.link', baseEmbedColor: '#ffffff' }));

    mockDatabase = {
      getAllMuteModeUsers: jest.fn(),
      getValue: jest.fn(),
      getUserJoinTime: jest.fn(),
      getGuildName: jest.fn().mockResolvedValue('Test Guild')
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    const { createMockGuild, createMockMember } = require('../../tests/testUtils');
    mockMember = createMockMember({ id: 'user123', kick: jest.fn().mockResolvedValue(true) });
    mockGuild = createMockGuild({ id: 'guild123' });
    mockGuild.members.fetch.mockResolvedValue(mockMember);

    mockClient = {
      guilds: {
        cache: new Map([['guild123', mockGuild]]),
        first: () => mockGuild
      }
    };

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
      muteModeUtils.scheduleMuteKick('user123', new Date(), 1, mockClient, 'guild123');
      expect(muteModeUtils.cancelMuteKick('user123')).toBe(true);
    });
  });

  describe('scheduleMuteKick', () => {
    it('should execute kick immediately if time is already up', async () => {
      // 2 hours ago
      const joinTime = dayjs().subtract(2, 'hour').toDate();
      mockDatabase.getUserJoinTime.mockResolvedValueOnce(joinTime);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');

      expect(mockDatabase.getUserJoinTime).toHaveBeenCalledWith('user123');
      expect(mockMember.kick).toHaveBeenCalledWith('User did not send a message in time.');
      expect(mockMember.send).toHaveBeenCalled();
    });

    it('should schedule a kick if time is not up', async () => {
      const joinTime = new Date(); // now
      mockDatabase.getUserJoinTime.mockResolvedValue(joinTime);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');
      
      expect(mockMember.kick).not.toHaveBeenCalled();

      // fast forward 1 hour
      await jest.runAllTimersAsync();

      expect(mockMember.kick).toHaveBeenCalled();
    });

    it('should not kick if user is no longer in mute mode', async () => {
      const joinTime = new Date();
      // returns null meaning user not in mute mode
      mockDatabase.getUserJoinTime.mockResolvedValue(null);

      await muteModeUtils.scheduleMuteKick('user123', joinTime, 1, mockClient, 'guild123');
      
      await jest.runAllTimersAsync();

      expect(mockMember.kick).not.toHaveBeenCalled();
    });
  });

  describe('rescheduleAllMuteKicks', () => {
    it('should reschedule kicks for all users', async () => {
      mockDatabase.getValue.mockResolvedValueOnce('2'); // 2 hours
      mockDatabase.getAllMuteModeUsers.mockResolvedValueOnce([
        { user_id: 'user1', join_time: new Date() },
        { user_id: 'user2', join_time: new Date() }
      ]);
      mockDatabase.getUserJoinTime.mockResolvedValue(new Date());

      await muteModeUtils.rescheduleAllMuteKicks(mockClient);

      expect(mockDatabase.getValue).toHaveBeenCalledWith('mute_mode_kick_time_hours');
      
      // cancel existing, should be true
      muteModeUtils.cancelMuteKick('user1');
      muteModeUtils.cancelMuteKick('user2');
    });

    it('should do nothing if no users found', async () => {
      mockDatabase.getValue.mockResolvedValueOnce('2');
      mockDatabase.getAllMuteModeUsers.mockResolvedValueOnce([]);

      await muteModeUtils.rescheduleAllMuteKicks(mockClient);

      // Verify no kicks scheduled
      expect(muteModeUtils.cancelMuteKick('user1')).toBe(false);
    });
  });
});
