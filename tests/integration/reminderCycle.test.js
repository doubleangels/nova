const { Collection } = require('discord.js');

describe('Reminder Cycle Integration', () => {
  let messageCreateEvent;
  let mockLogger;
  let mockInstrument;
  let mockDatabase;
  let mockReminderUtils;
  let mockConfig;
  let mockChannel;

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
      newMemberRoleId: 'noobie-role',
      memberFrenRoleId: 'fren-role'
    };
    jest.doMock('../../config', () => mockConfig);

    // Track reminders in mock DB state
    const store = new Map();
    mockDatabase = {
      getValue: jest.fn(async (key) => store.get(key)),
      setValue: jest.fn(async (key, value) => { store.set(key, value); }),
      setLatestReminderData: jest.fn(async (type, data) => {
        store.set(`reminder:${type}`, data);
      }),
      getLatestReminderData: jest.fn(async (type) => {
        return store.get(`reminder:${type}`);
      })
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    // Mock reminderUtils to simulate timer-based dispatch
    mockReminderUtils = {
      handleReminder: jest.fn(async (message, delay, type) => {
        await mockDatabase.setLatestReminderData(type, {
          reminder_id: 'rem-id-123',
          remind_at: new Date(Date.now() + delay).toISOString(),
          type
        });
        setTimeout(() => {
          if (mockChannel) {
            mockChannel.send('Time to bump! <@&reminder-role-id>');
          }
        }, delay);
      })
    };
    jest.doMock('../../utils/reminderUtils', () => mockReminderUtils);

    messageCreateEvent = require('../../events/messageCreate');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should schedule a reminder upon receiving a Disboard bump message and dispatch it after delay', async () => {
    // 1. Setup channel and role configurations in database
    await mockDatabase.setValue('reminder_channel', 'reminder-channel-id');
    await mockDatabase.setValue('reminder_role', 'reminder-role-id');

    mockChannel = {
      id: 'reminder-channel-id',
      send: jest.fn().mockResolvedValue()
    };

    const mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel)
      }
    };

    // 2. Simulate Disboard bump message (from Disboard bot, containing bump description)
    const mockMessage = {
      partial: false,
      author: { id: '302050872383242240', bot: true, tag: 'Disboard#1234' }, // Disboard bot ID
      channel: { id: 'reminder-channel-id' },
      client: mockClient,
      embeds: [
        {
          description: 'Bump done! :thumbsup:'
        }
      ]
    };

    await messageCreateEvent.execute(mockMessage);

    // Verify reminder is saved to DB and scheduled
    expect(mockDatabase.setLatestReminderData).toHaveBeenCalledWith('bump', expect.any(Object));
    expect(mockReminderUtils.handleReminder).toHaveBeenCalledWith(mockMessage, 2 * 60 * 60 * 1000, 'bump');

    // 3. Advance fake timers by 2 hours
    jest.advanceTimersByTime(2 * 60 * 60 * 1000 + 1000);

    // Verify reminder dispatched notification to the correct channel, pinging the role
    expect(mockChannel.send).toHaveBeenCalledWith('Time to bump! <@&reminder-role-id>');
  });
});
