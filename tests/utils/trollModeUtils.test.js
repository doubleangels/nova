const dayjs = require('dayjs');

describe('trollModeUtils', () => {
  let trollModeUtils;
  let mockDatabase;
  let mockLogger;
  let mockMember;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({ serverInviteUrl: 'http://invite.link', baseEmbedColor: '#000000' }));

    mockDatabase = {
      getValue: jest.fn(),
      getGuildName: jest.fn().mockResolvedValue('Test Guild')
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    const { createMockMember } = require('../../tests/testUtils');
    mockMember = createMockMember({ id: 'user123', kick: jest.fn().mockResolvedValue(true) });

    trollModeUtils = require('../../utils/trollModeUtils');
  });

  describe('checkAccountAge', () => {
    it('should return true if troll mode is disabled', async () => {
      mockDatabase.getValue.mockResolvedValueOnce(false); // troll_mode_enabled
      const result = await trollModeUtils.checkAccountAge(mockMember);
      expect(result).toBe(true);
    });

    it('should return true if account is older than required age', async () => {
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'troll_mode_enabled') return true;
        if (key === 'troll_mode_account_age') return '30';
        return null;
      });
      // 40 days old
      mockMember.user.createdAt = dayjs().subtract(40, 'day').toDate();

      const result = await trollModeUtils.checkAccountAge(mockMember);
      expect(result).toBe(true);
    });

    it('should return false if account is newer than required age', async () => {
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'troll_mode_enabled') return true;
        // troll_mode_account_age is null -> falls back to 30
        return null;
      });
      // 10 days old
      mockMember.user.createdAt = dayjs().subtract(10, 'day').toDate();

      const result = await trollModeUtils.checkAccountAge(mockMember);
      expect(result).toBe(false);
    });

    it('should handle errors gracefully and deny user when check fails', async () => {
      mockDatabase.getValue.mockRejectedValue(new Error('DB Error'));
      const result = await trollModeUtils.checkAccountAge(mockMember);
      expect(result).toBe(false);
    });
  });

  describe('performKick', () => {
    it('should send DM and kick user', async () => {
      mockDatabase.getValue.mockResolvedValue(null); // falls back to 30
      mockMember.user.createdAt = dayjs().subtract(10, 'day').toDate();

      await trollModeUtils.performKick(mockMember);

      expect(mockMember.send).toHaveBeenCalled();
      expect(mockMember.kick).toHaveBeenCalledWith('Account age does not meet server requirements.');
    });

    it('should kick user even if DM fails', async () => {
      mockDatabase.getValue.mockResolvedValue('30');
      mockMember.user.createdAt = dayjs().subtract(10, 'day').toDate();
      mockMember.send.mockRejectedValue(new Error('Cannot send DM'));

      await trollModeUtils.performKick(mockMember);

      expect(mockMember.kick).toHaveBeenCalledWith('Account age does not meet server requirements.');
    });

    it('should log and throw error if kick fails', async () => {
      mockDatabase.getValue.mockResolvedValue('30');
      mockMember.user.createdAt = dayjs().subtract(10, 'day').toDate();
      const kickError = new Error('Kick permissions denied');
      mockMember.kick.mockRejectedValue(kickError);

      await expect(trollModeUtils.performKick(mockMember)).rejects.toThrow('Kick permissions denied');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to kick member.', expect.any(Object));
    });

    it('should mark pending age kick before kicking and clear it when kick fails', async () => {
      const {
        consumePendingAgeKick,
        resetPendingAgeKicksForTests
      } = require('../../utils/ageKickTracking');
      resetPendingAgeKicksForTests();

      mockDatabase.getValue.mockResolvedValue('30');
      mockMember.user.createdAt = dayjs().subtract(10, 'day').toDate();

      await trollModeUtils.performKick(mockMember);
      expect(consumePendingAgeKick(mockMember.id)).toBe(true);

      resetPendingAgeKicksForTests();
      mockMember.kick.mockRejectedValue(new Error('Kick permissions denied'));
      await expect(trollModeUtils.performKick(mockMember)).rejects.toThrow('Kick permissions denied');
      expect(consumePendingAgeKick(mockMember.id)).toBe(false);
    });
  });
});
