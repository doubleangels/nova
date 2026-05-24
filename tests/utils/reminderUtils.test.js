const dayjs = require('dayjs');

describe('reminderUtils', () => {
  let reminderUtils;
  let mockDatabase;
  let mockLogger;
  let reminderKeyvInstance;
  let mockGetSharedKeyvStore;
  let mockClient;
  let mockChannel;

  function setupConfig({ role = 'role-123', channel = 'channel-123' } = {}) {
    mockDatabase.getValue.mockImplementation(async (k) => {
      if (k === 'reminder_role') return role;
      if (k === 'reminder_channel') return channel;
      return null;
    });
  }

  function getKeyvErrorHandler() {
    const call = reminderKeyvInstance.on.mock.calls.find((c) => c[0] === 'error');
    return call ? call[1] : null;
  }

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({}));

    mockDatabase = {
      getValue: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    mockGetSharedKeyvStore = jest.fn(() => ({}));
    jest.doMock('../../utils/sqliteStore', () => ({
      getSharedKeyvStore: mockGetSharedKeyvStore
    }));

    const MockKeyvClass = require('../../tests/__mocks__/keyv.mock');
    jest.doMock('keyv', () =>
      jest.fn().mockImplementation((opts) => {
        reminderKeyvInstance = new MockKeyvClass(opts);
        return reminderKeyvInstance;
      })
    );
    jest.doMock('@keyv/sqlite', () => jest.fn().mockImplementation(() => ({})));

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

  describe('module initialization', () => {
    it('should use getSharedKeyvStore for Keyv and logs connection errors', () => {
      expect(mockGetSharedKeyvStore).toHaveBeenCalled();
      expect(reminderKeyvInstance.on).toHaveBeenCalledWith('error', expect.any(Function));

      const err = new Error('keyv connection failed');
      getKeyvErrorHandler()(err);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Reminder Keyv connection error occurred.',
        { err }
      );
    });

    it('should export NEEDAFRIEND_REMINDER_MS as seven days', () => {
      expect(reminderUtils.NEEDAFRIEND_REMINDER_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('getLatestReminderData', () => {
    it('should return null when no reminders exist', async () => {
      reminderKeyvInstance.get.mockResolvedValue([]);
      const result = await reminderUtils.getLatestReminderData('bump');
      expect(result).toBeNull();
    });

    it('should skip invalid dates, missing remind_at, and past reminders', async () => {
      const futureSoon = dayjs().add(1, 'hour').toISOString();
      const futureLater = dayjs().add(2, 'hour').toISOString();
      const past = dayjs().subtract(1, 'hour').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') {
          return ['past', 'invalid', 'missing', 'soon', 'later'];
        }
        const map = {
          'reminder:past': { reminder_id: 'past', remind_at: past, type: 'bump' },
          'reminder:invalid': { reminder_id: 'invalid', remind_at: 'not-a-date', type: 'bump' },
          'reminder:missing': { reminder_id: 'missing', type: 'bump' },
          'reminder:soon': { reminder_id: 'soon', remind_at: futureSoon, type: 'bump' },
          'reminder:later': { reminder_id: 'later', remind_at: futureLater, type: 'bump' }
        };
        return map[k] ?? null;
      });

      const result = await reminderUtils.getLatestReminderData('bump');
      expect(result).toEqual({
        reminder_id: 'soon',
        remind_at: futureSoon,
        type: 'bump'
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid date found for reminder.',
        expect.objectContaining({ reminderId: 'invalid' })
      );
    });

    it('should return null and logs on error', async () => {
      reminderKeyvInstance.get.mockRejectedValue(new Error('keyv read failed'));
      const result = await reminderUtils.getLatestReminderData('bump');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while getting latest reminder data.',
        expect.objectContaining({ err: expect.any(Error) })
      );
    });
  });

  describe('getNextReminderTimeAfterCleanup', () => {
    it('should remove expired and invalid reminders then returns next time', async () => {
      const future = dayjs().add(30, 'minute').toISOString();
      const past = dayjs().subtract(1, 'hour').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['expired', 'valid'];
        if (k === 'reminder:expired') return { reminder_id: 'expired', remind_at: past, type: 'bump' };
        if (k === 'reminder:valid') return { reminder_id: 'valid', remind_at: future, type: 'bump' };
        return null;
      });

      const next = await reminderUtils.getNextReminderTimeAfterCleanup('bump');
      expect(next).toBe(future);
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:expired');
      expect(reminderKeyvInstance.set).toHaveBeenCalledWith('reminders:bump:list', ['valid']);
    });

    it('should clean null entries and invalid remind_at values', async () => {
      const future = dayjs().add(1, 'hour').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:promote:list') return ['ghost', 'bad-date', 'ok'];
        if (k === 'reminder:ghost') return null;
        if (k === 'reminder:bad-date') return { reminder_id: 'bad-date', remind_at: 'nope', type: 'promote' };
        if (k === 'reminder:ok') return { reminder_id: 'ok', remind_at: future, type: 'promote' };
        return null;
      });

      const next = await reminderUtils.getNextReminderTimeAfterCleanup('promote');
      expect(next).toBe(future);
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:ghost');
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:bad-date');
    });

    it('should remove entries with missing remind_at', async () => {
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:needafriend:list') return ['no-time'];
        if (k === 'reminder:no-time') return { reminder_id: 'no-time', type: 'needafriend' };
        return null;
      });

      const next = await reminderUtils.getNextReminderTimeAfterCleanup('needafriend');
      expect(next).toBeNull();
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:no-time');
    });

    it('should return null and logs on error', async () => {
      reminderKeyvInstance.get.mockRejectedValue(new Error('cleanup failed'));
      const next = await reminderUtils.getNextReminderTimeAfterCleanup('bump');
      expect(next).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in getNextReminderTimeAfterCleanup.',
        expect.objectContaining({ type: 'bump' })
      );
    });

    it('should return null when reminder list is empty and nothing to clean', async () => {
      reminderKeyvInstance.get.mockResolvedValue(null);
      const next = await reminderUtils.getNextReminderTimeAfterCleanup('bump');
      expect(next).toBeNull();
      expect(reminderKeyvInstance.delete).not.toHaveBeenCalled();
    });

    it('should return next time without cleanup when all reminders are valid', async () => {
      const future = dayjs().add(2, 'hour').toISOString();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['ok'];
        if (k === 'reminder:ok') return { reminder_id: 'ok', remind_at: future, type: 'bump' };
        return null;
      });

      const next = await reminderUtils.getNextReminderTimeAfterCleanup('bump');
      expect(next).toBe(future);
      expect(reminderKeyvInstance.delete).not.toHaveBeenCalled();
    });
  });

  describe('handleReminder', () => {
    it('should not schedule if role is missing', async () => {
      mockDatabase.getValue.mockResolvedValueOnce(null);
      await reminderUtils.handleReminder({ client: mockClient }, 1000);
      expect(reminderKeyvInstance.set).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("reminder_role")
      );
    });

    it('should not schedule if channel config is missing', async () => {
      mockDatabase.getValue.mockImplementation(async (k) => {
        if (k === 'reminder_role') return 'role-123';
        return null;
      });
      await reminderUtils.handleReminder({ client: mockClient }, 1000);
      expect(reminderKeyvInstance.set).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("reminder_channel")
      );
    });

    it('should return early when channel fetch fails', async () => {
      setupConfig();
      mockClient.channels.cache = new Map();
      mockClient.channels.fetch.mockRejectedValue(new Error('channel gone'));

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });

      await reminderUtils.handleReminder({ client: mockClient }, 1000);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to fetch channel.',
        expect.objectContaining({ channelId: 'channel-123' })
      );
      expect(reminderKeyvInstance.set).not.toHaveBeenCalled();
    });

    it('should clean existing future, expired, and invalid reminders before scheduling', async () => {
      setupConfig();
      const future = dayjs().add(2, 'hour').toISOString();
      const past = dayjs().subtract(1, 'hour').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['future', 'expired', 'broken'];
        if (k === 'reminder:future') return { reminder_id: 'future', remind_at: future, type: 'bump' };
        if (k === 'reminder:expired') return { reminder_id: 'expired', remind_at: past, type: 'bump' };
        if (k === 'reminder:broken') return null;
        return null;
      });

      await reminderUtils.handleReminder({ client: mockClient }, 60000, 'bump');
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:future');
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:expired');
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:broken');
      expect(reminderKeyvInstance.set).toHaveBeenCalledWith(
        'reminders:bump:list',
        expect.any(Array)
      );
    });

    it('should schedule bump reminder and send confirmation and ping', async () => {
      setupConfig();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });

      await reminderUtils.handleReminder({ client: mockClient }, 60000, 'bump');
      expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Thanks for bumping!'));

      await jest.runAllTimersAsync();
      expect(mockChannel.send).toHaveBeenCalledWith(expect.stringContaining('Time to bump the server!'));
      expect(reminderKeyvInstance.delete).toHaveBeenCalled();
    });

    it('should send promote and needafriend confirmation messages', async () => {
      setupConfig();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });

      await reminderUtils.handleReminder({ client: mockClient }, 5000, 'promote');
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('Server promoted successfully')
      );

      mockChannel.send.mockClear();
      await reminderUtils.handleReminder({ client: mockClient }, 5000, 'needafriend');
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('r/needafriend')
      );
    });

    it('should send promote and needafriend scheduled pings', async () => {
      setupConfig();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });

      await reminderUtils.handleReminder({ client: mockClient }, 1000, 'promote');
      await jest.runAllTimersAsync();
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('Time to promote the server')
      );

      mockChannel.send.mockClear();
      await reminderUtils.handleReminder({ client: mockClient }, 1000, 'needafriend');
      await jest.runAllTimersAsync();
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('r/needafriend weekly ad thread')
      );
    });

    it('should skip confirmation when skipConfirmation is true', async () => {
      setupConfig();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });

      await reminderUtils.handleReminder({ client: mockClient }, 1000, 'bump', true);
      expect(mockChannel.send).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping confirmation message as requested.',
        expect.any(Object)
      );
    });

    it('should log warn when confirmation send fails but still schedules', async () => {
      setupConfig();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });
      mockChannel.send.mockRejectedValueOnce(new Error('send blocked'));

      await reminderUtils.handleReminder({ client: mockClient }, 1000, 'bump');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to send confirmation message, reminder was still saved.',
        expect.any(Object)
      );
    });

    it('should log error when scheduled ping send fails', async () => {
      setupConfig();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });
      mockChannel.send
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('ping failed'));

      await reminderUtils.handleReminder({ client: mockClient }, 1000, 'bump');
      await jest.runAllTimersAsync();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while sending scheduled reminder.',
        expect.objectContaining({ type: 'bump' })
      );
    });

    it('should fetch channel from API when not in cache', async () => {
      setupConfig();
      mockClient.channels.cache = new Map();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k.endsWith(':list')) return [];
        return null;
      });

      await reminderUtils.handleReminder({ client: mockClient }, 1000, 'bump');
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-123');
    });

    it('should log unexpected errors from getValue', async () => {
      mockDatabase.getValue.mockRejectedValue(new Error('db down'));
      await reminderUtils.handleReminder({ client: mockClient }, 1000);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error in handleReminder.',
        expect.any(Object)
      );
    });
  });

  describe('rescheduleReminder', () => {
    it('should return when reminder channel config is missing', async () => {
      mockDatabase.getValue.mockImplementation(async (k) => {
        if (k === 'reminder_role') return 'role-123';
        return null;
      });
      await reminderUtils.rescheduleReminder(mockClient);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('reminder channel is not configured')
      );
    });

    it('should return when reminder role config is missing', async () => {
      mockDatabase.getValue.mockImplementation(async (k) => {
        if (k === 'reminder_channel') return 'channel-123';
        return null;
      });
      await reminderUtils.rescheduleReminder(mockClient);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('reminder role is not configured')
      );
    });

    it('should reschedule active bump reminders', async () => {
      setupConfig();
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

    it('should cleanup expired bump reminders', async () => {
      setupConfig();
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
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No active reminders found for rescheduling')
      );
    });

    it('should clean invalid and expired promote reminders and reschedules active ones', async () => {
      setupConfig();
      const future = dayjs().add(45, 'minute').toISOString();
      const past = dayjs().subtract(2, 'hour').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return [];
        if (k === 'reminders:promote:list') return ['expired', 'active', 'invalid'];
        if (k === 'reminders:needafriend:list') return [];
        if (k === 'reminder:expired') return { reminder_id: 'expired', remind_at: past, type: 'promote' };
        if (k === 'reminder:active') return { reminder_id: 'active', remind_at: future, type: 'promote' };
        if (k === 'reminder:invalid') return { reminder_id: 'invalid', type: 'promote' };
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:expired');
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:invalid');

      await jest.runAllTimersAsync();
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('Time to promote the server')
      );
    });

    it('should clean invalid and expired needafriend reminders and reschedules active ones', async () => {
      setupConfig();
      const future = dayjs().add(20, 'minute').toISOString();
      const past = dayjs().subtract(3, 'hour').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return [];
        if (k === 'reminders:promote:list') return [];
        if (k === 'reminders:needafriend:list') return ['old', 'live', 'broken'];
        if (k === 'reminder:old') return { reminder_id: 'old', remind_at: past, type: 'needafriend' };
        if (k === 'reminder:live') return { reminder_id: 'live', remind_at: future, type: 'needafriend' };
        if (k === 'reminder:broken') return null;
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:old');
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:broken');

      await jest.runAllTimersAsync();
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('r/needafriend weekly ad thread')
      );
    });

    it('should mark invalid bump reminder data for cleanup', async () => {
      setupConfig();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['bad-bump'];
        if (k === 'reminders:promote:list') return [];
        if (k === 'reminders:needafriend:list') return [];
        if (k === 'reminder:bad-bump') return { reminder_id: 'bad-bump', type: 'bump' };
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);
      expect(reminderKeyvInstance.delete).toHaveBeenCalledWith('reminder:bad-bump');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Marked invalid bump reminder for cleanup.',
        expect.any(Object)
      );
    });

    it('should warn when reschedule delay is zero or negative', async () => {
      jest.resetModules();
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      mockLogger = require('../../tests/__mocks__/logger.mock')();
      jest.doMock('../../logger', () => () => mockLogger);
      jest.doMock('../../config', () => ({}));

      mockDatabase = { getValue: jest.fn() };
      jest.doMock('../../utils/database', () => mockDatabase);
      mockGetSharedKeyvStore = jest.fn(() => ({}));
      jest.doMock('../../utils/sqliteStore', () => ({
        getSharedKeyvStore: mockGetSharedKeyvStore
      }));

      const realDayjs = jest.requireActual('dayjs');
      const originalDiff = realDayjs.prototype.diff;
      jest.spyOn(realDayjs.prototype, 'diff').mockImplementation(function (other, unit, float) {
        if (unit === 'millisecond') return -1;
        return originalDiff.call(this, other, unit, float);
      });
      jest.doMock('dayjs', () => realDayjs);

      const MockKeyvClass = require('../../tests/__mocks__/keyv.mock');
      jest.doMock('keyv', () =>
        jest.fn().mockImplementation((opts) => {
          reminderKeyvInstance = new MockKeyvClass(opts);
          return reminderKeyvInstance;
        })
      );
      jest.doMock('@keyv/sqlite', () => jest.fn().mockImplementation(() => ({})));

      mockChannel = { id: 'channel-123', send: jest.fn().mockResolvedValue(true) };
      mockClient = {
        channels: {
          cache: new Map([['channel-123', mockChannel]]),
          fetch: jest.fn().mockResolvedValue(mockChannel)
        }
      };

      reminderUtils = require('../../utils/reminderUtils');
      setupConfig();

      const future = dayjs().add(1, 'hour').toISOString();
      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['b1'];
        if (k === 'reminders:promote:list') return ['p1'];
        if (k === 'reminders:needafriend:list') return ['n1'];
        if (k === 'reminder:b1') return { reminder_id: 'b1', remind_at: future, type: 'bump' };
        if (k === 'reminder:p1') return { reminder_id: 'p1', remind_at: future, type: 'promote' };
        if (k === 'reminder:n1') return { reminder_id: 'n1', remind_at: future, type: 'needafriend' };
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Bump reminder is in the past; skipping reschedule.',
        expect.any(Object)
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Promote reminder is in the past; skipping reschedule.',
        expect.any(Object)
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Needafriend reminder is in the past; skipping reschedule.',
        expect.any(Object)
      );
      expect(mockChannel.send).not.toHaveBeenCalled();
      realDayjs.prototype.diff.mockRestore();
    });

    it('should return when channel fetch fails', async () => {
      setupConfig();
      const future = dayjs().add(1, 'hour').toISOString();

      mockClient.channels.cache = new Map();
      mockClient.channels.fetch.mockRejectedValue(new Error('no channel'));

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['rem-1'];
        if (k === 'reminders:promote:list') return [];
        if (k === 'reminders:needafriend:list') return [];
        if (k === 'reminder:rem-1') {
          return { reminder_id: 'rem-1', remind_at: future, type: 'bump' };
        }
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to fetch channel for rescheduled reminder.',
        expect.any(Object)
      );
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('should log errors when rescheduled bump ping fails', async () => {
      setupConfig();
      const future = dayjs().add(10, 'minute').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['rem-1'];
        if (k === 'reminders:promote:list') return [];
        if (k === 'reminders:needafriend:list') return [];
        if (k === 'reminder:rem-1') {
          return { reminder_id: 'rem-1', remind_at: future, type: 'bump' };
        }
        return null;
      });

      mockChannel.send.mockRejectedValue(new Error('reschedule send failed'));
      await reminderUtils.rescheduleReminder(mockClient);
      await jest.runAllTimersAsync();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while sending rescheduled bump reminder.',
        expect.any(Object)
      );
    });

    it('should log errors when rescheduled promote ping fails', async () => {
      setupConfig();
      const future = dayjs().add(10, 'minute').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return [];
        if (k === 'reminders:promote:list') return ['p1'];
        if (k === 'reminders:needafriend:list') return [];
        if (k === 'reminder:p1') {
          return { reminder_id: 'p1', remind_at: future, type: 'promote' };
        }
        return null;
      });

      mockChannel.send.mockRejectedValue(new Error('promote send failed'));
      await reminderUtils.rescheduleReminder(mockClient);
      await jest.runAllTimersAsync();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while sending rescheduled promotion reminder.',
        expect.any(Object)
      );
    });

    it('should log errors when rescheduled needafriend ping fails', async () => {
      setupConfig();
      const future = dayjs().add(10, 'minute').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return [];
        if (k === 'reminders:promote:list') return [];
        if (k === 'reminders:needafriend:list') return ['n1'];
        if (k === 'reminder:n1') {
          return { reminder_id: 'n1', remind_at: future, type: 'needafriend' };
        }
        return null;
      });

      mockChannel.send.mockRejectedValue(new Error('needafriend send failed'));
      await reminderUtils.rescheduleReminder(mockClient);
      await jest.runAllTimersAsync();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred while sending rescheduled needafriend reminder.',
        expect.any(Object)
      );
    });

    it('should log top-level errors', async () => {
      setupConfig();
      reminderKeyvInstance.get.mockRejectedValue(new Error('reschedule boom'));
      await reminderUtils.rescheduleReminder(mockClient);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred in rescheduleReminder.',
        expect.any(Object)
      );
    });

    it('should fetch channel from API when not cached', async () => {
      setupConfig();
      const future = dayjs().add(15, 'minute').toISOString();
      mockClient.channels.cache = new Map();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['rem-1'];
        if (k === 'reminders:promote:list') return [];
        if (k === 'reminders:needafriend:list') return [];
        if (k === 'reminder:rem-1') {
          return { reminder_id: 'rem-1', remind_at: future, type: 'bump' };
        }
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-123');
    });

    it('should log cleaned up expired counts across types', async () => {
      setupConfig();
      const past = dayjs().subtract(1, 'day').toISOString();

      reminderKeyvInstance.get.mockImplementation(async (k) => {
        if (k === 'reminders:bump:list') return ['b1'];
        if (k === 'reminders:promote:list') return ['p1'];
        if (k === 'reminders:needafriend:list') return ['n1'];
        if (k === 'reminder:b1') return { reminder_id: 'b1', remind_at: past, type: 'bump' };
        if (k === 'reminder:p1') return { reminder_id: 'p1', remind_at: past, type: 'promote' };
        if (k === 'reminder:n1') return { reminder_id: 'n1', remind_at: past, type: 'needafriend' };
        return null;
      });

      await reminderUtils.rescheduleReminder(mockClient);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaned up expired reminders.',
        expect.objectContaining({
          expiredBumpCount: 1,
          expiredPromoteCount: 1,
          expiredNeedafriendCount: 1
        })
      );
    });
  });

  describe('addReminderId', () => {
    it('should add id when not already in list', async () => {
      reminderKeyvInstance.get.mockResolvedValueOnce([]);
      await reminderUtils.addReminderId('bump', 'rem-new');
      expect(reminderKeyvInstance.set).toHaveBeenCalledWith('reminders:bump:list', ['rem-new']);
    });

    it('should not duplicate existing id', async () => {
      reminderKeyvInstance.get.mockResolvedValueOnce(['rem-1']);
      await reminderUtils.addReminderId('bump', 'rem-1');
      expect(reminderKeyvInstance.set).not.toHaveBeenCalled();
    });
  });

  describe('handleError', () => {
    const cases = [
      ['DATABASE_ERROR', 'Database error'],
      ['REMINDER_CREATION_FAILED', 'Failed to create reminder'],
      ['REMINDER_DELETION_FAILED', 'Failed to delete reminder'],
      ['REMINDER_UPDATE_FAILED', 'Failed to update reminder'],
      ['INVALID_TIME', 'Invalid time format'],
      ['INVALID_DATE', 'Invalid date format'],
      ['PAST_DATE', 'past date'],
      ['INVALID_INTERVAL', 'Invalid interval'],
      ['OTHER', 'unexpected error']
    ];

    it.each(cases)('maps %s to user-facing error', async (code, fragment) => {
      await expect(reminderUtils.handleError(new Error(code), 'test')).rejects.toThrow(fragment);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
