const { Collection } = require('discord.js');

describe('Spam Detection and Moderation Button Flow Integration', () => {
  let messageCreateEvent;
  let interactionCreateEvent;
  let mockLogger;
  let mockInstrument;
  let mockDatabase;
  let mockConfig;

  beforeEach(() => {
    jest.resetModules();

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

    // Track state in local DB mock
    const store = new Map();
    mockDatabase = {
      getValue: jest.fn(async (key) => store.get(key)),
      setValue: jest.fn(async (key, value) => { store.set(key, value); }),
      addMuteModeUser: jest.fn().mockResolvedValue(),
      removeMuteModeUser: jest.fn().mockResolvedValue(),
      addSpamModeJoinTime: jest.fn().mockResolvedValue(),
      isFormerMember: jest.fn().mockResolvedValue(false),
      incrementMessageCount: jest.fn().mockResolvedValue(1)
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    mockConfig = {
      newMemberRoleId: 'noobie-role',
      memberFrenRoleId: 'fren-role',
      spamLogsChannelId: 'spam-logs-123'
    };
    jest.doMock('../../config', () => mockConfig);

    messageCreateEvent = require('../../events/messageCreate');
    interactionCreateEvent = require('../../events/interactionCreate');
  });

  it('should process user messages, trigger spam actions, and handle moderator timeout button click E2E', async () => {
    // 1. Enable spam mode
    await mockDatabase.setValue('spam_mode_enabled', true);
    await mockDatabase.setValue('spam_mode_channel_id', 'spam-logs-123');

    // 2. Simulate messages in rapid succession that trigger spam warnings
    const mockMessage = {
      partial: false,
      id: 'msg-123',
      content: 'SPAM MESSAGE CONTENT EXTRACTED',
      author: { bot: false, tag: 'Spammer#1234', id: '123456789012345678' },
      channel: { id: 'chan-general', name: 'general' },
      channelId: 'chan-general',
      attachments: new Collection(),
      stickers: new Collection(),
      member: {
        roles: {
          cache: new Collection()
        }
      }
    };

    // Trigger execution
    await messageCreateEvent.execute(mockMessage);

    // 3. Simulate moderator interacting with the "Timeout 1h" button sent to spam logs
    const mockTargetMember = {
      id: '123456789012345678',
      user: { tag: 'Spammer#1234' },
      roles: {
        highest: { position: 1 }
      },
      timeout: jest.fn().mockResolvedValue()
    };

    const mockInteraction = {
      isButton: jest.fn(() => true),
      isCommand: jest.fn(() => false),
      isAutocomplete: jest.fn(() => false),
      isChatInputCommand: jest.fn(() => false),
      isMessageContextMenuCommand: jest.fn(() => false),
      isUserContextMenuCommand: jest.fn(() => false),
      customId: 'spamWarn:timeout1h:123456789012345678',
      user: { id: 'moderator-1', tag: 'Mod#0001' },
      channelId: 'spam-logs-123',
      guild: {
        id: 'guild-123',
        members: {
          fetch: jest.fn().mockResolvedValue(mockTargetMember),
          me: {
            roles: {
              highest: { position: 10 }
            },
            permissions: {
              has: jest.fn().mockReturnValue(true) // Lacks nothing
            }
          }
        }
      },
      member: {
        permissions: {
          has: jest.fn().mockReturnValue(true) // Has mod permissions
        }
      },
      message: {
        id: 'warn-msg-123',
        edit: jest.fn().mockResolvedValue()
      },
      reply: jest.fn().mockResolvedValue()
    };

    await interactionCreateEvent.execute(mockInteraction);

    // Verify mod pardon click successfully resolved the alert
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Timed out'),
      flags: 64 // MessageFlags.Ephemeral
    }));
    expect(mockTargetMember.timeout).toHaveBeenCalled();
  });
});
