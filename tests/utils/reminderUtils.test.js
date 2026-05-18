const dayjs = require('dayjs');

describe('reminderUtils', () => {
  let reminderUtils;
  let mockDatabase;
  let mockLogger;
  let reminderKeyvInstance;
  let mockClient;
  let mockChannel;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({}));

    mockDatabase = {
      getValue: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    const MockKeyvClass = require('../../tests/__mocks__/keyv.mock');
    jest.doMock('keyv', () => {
      return jest.fn().mockImplementation((opts) => {
        reminderKeyvInstance = new MockKeyvClass(opts);
        return reminderKeyvInstance;
      });
    });
    
    jest.doMock('@keyv/sqlite', () => {
      return jest.fn().mockImplementation(() => ({}));
    });

    const { createMockGuild } = require('../../tests/testUtils');
    mockChannel = { id: 'channel-123', send: jest.fn().mockResolvedValue(true) };
    mockClient = {
      channels: {
        cache: new Map([['channel-123', mockChannel]]),
        fetch: jest.fn().mockResolvedValue(mockChannel)
      }
    };

    reminderUtils = require('../../utils/reminderUtils');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('handleReminder', () => {
    it('should not schedule if role is missing', async () => {
      mockDatabase.getValue.mockResolvedValueOnce(null); // reminder_role
      await reminderUtils.handleReminder({ client: mockClient }, 1000);
      expect(reminderKeyvInstance.set).not.toHaveBeenCalled();
    });

    it('should schedule and execute a reminder', async () => {
      mockDatabase.getValue.mockImplementation(async (k) => {
        if (k === 'reminder_role') return 'role-123';
        if (k === 'reminder_channel') return 'channel-123';
        return null;
      });

      // No existing reminders
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });
      // Setup verify pass
      const realSet = reminderKeyvInstance.set;
      reminderKeyvInstance.set = jest.fn(async (k, v) => {
        await realSet(k, v);
        // Also simulate successful retrieve for verification
        reminderKeyvInstance.get.mockImplementation(async (gk) => {
          if (gk === k) return v;
          if (gk.endsWith(':list')) return k.endsWith(':list') ? v : [v.reminder_id || v[0]];
          return null;
        });
      });

      await reminderUtils.handleReminder({ client: mockClient }, 60000, 'bump');

      expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Thanks for bumping!'));

      // Fast forward
      await jest.runAllTimersAsync();

      expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Time to bump the server!'));
      // should have deleted the reminder
      expect(reminderKeyvInstance.delete).toHaveBeenCalled();
    });
  });

  describe('rescheduleReminder', () => {
    it('should reschedule active reminders', async () => {
      mockDatabase.getValue.mockImplementation(async (k) => {
        if (k === 'reminder_role') return 'role-123';
        if (k === 'reminder_channel') return 'channel-123';
        return null;
      });

      // Future date
      const future = dayjs().add(1, 'hour').toISOString();
      const mockReminder = { reminder_id: 'rem-1', remind_at: future, type: 'bump' };
      
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['rem-1'];
        if (k === 'reminders:promote:list') return [];
        if (k === 'reminders:needafriend:list') return [];
        if (k === 'reminder:rem-1') return mockReminder;
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);

      await jest.runAllTimersAsync();

      expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Time to bump the server!'));
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:rem-1');
    });

    it('should cleanup expired reminders', async () => {
      mockDatabase.getValue.mockImplementation(async (k) => {
        if (k === 'reminder_role') return 'role-123';
        if (k === 'reminder_channel') return 'channel-123';
        return null;
      });

      // Past date
      const past = dayjs().subtract(1, 'hour').toISOString();
      const mockReminder = { reminder_id: 'rem-1', remind_at: past, type: 'bump' };
      
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['rem-1'];
        if (k === 'reminders:promote:list') return [];
        if (k === 'reminders:needafriend:list') return [];
        if (k === 'reminder:rem-1') return mockReminder;
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);

      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:rem-1');
      expect(mockChannel.send).not.toHaveBeenCalled();
    });
  });
});
