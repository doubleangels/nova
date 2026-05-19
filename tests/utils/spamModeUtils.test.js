const dayjs = require('dayjs');
const { PermissionFlagsBits, ButtonStyle, MessageFlags } = require('discord.js');

describe('spamModeUtils', () => {
  let spamModeUtils;
  let mockDatabase;
  let mockLogger;
  let mockMessage;
  let mockInteraction;
  
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    mockLogger = require('../../tests/__mocks__/logger.mock')();
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({}));

    mockDatabase = {
      getSpamModeJoinTime: jest.fn(),
      removeSpamModeJoinTime: jest.fn(),
      getValue: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    const { createMockMessage, createMockButton, createMockMember, createMockRole } = require('../../tests/testUtils');
    
    mockMessage = createMockMessage({
      content: 'Hello this is a test message',
      createdTimestamp: Date.now(),
      author: { id: 'user-123', username: 'test_user', bot: false, send: jest.fn().mockResolvedValue(true) }
    });
    mockInteraction = createMockButton();
    
    const botMember = createMockMember({ id: 'bot-123' });
    botMember.permissions.has = jest.fn(() => true);
    botMember.roles.highest = createMockRole({ position: 10 });
    
    mockMessage.guild.members.me = botMember;
    mockMessage.guild.members.fetch.mockImplementation(async (id) => {
      if (id === 'bot-123') return botMember;
      return mockMessage.member;
    });
    mockInteraction.guild = mockMessage.guild;
    mockInteraction.member = mockMessage.member;
    
    mockInteraction.guild.members.me = botMember;
    mockInteraction.guild.members.fetch.mockImplementation(async (id) => {
      if (id === 'bot-123') return botMember;
      return mockInteraction.member;
    });

    // Require the module AFTER setting up all mocks
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
      // 5 hours ago
      mockDatabase.getSpamModeJoinTime.mockResolvedValue(dayjs().subtract(5, 'hour').toDate());
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_window_hours') return '4';
        return null;
      });

      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.removeSpamModeJoinTime).toHaveBeenCalledWith(mockMessage.author.id);
    });

    it('should ignore slash commands', async () => {
      mockDatabase.getSpamModeJoinTime.mockResolvedValue(new Date());
      mockMessage.content = '/help';
      
      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockDatabase.removeSpamModeJoinTime).not.toHaveBeenCalled();
    });

    it('should track messages and detect spam', async () => {
      mockDatabase.getSpamModeJoinTime.mockResolvedValue(new Date());
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_window_hours') return '4';
        if (key === 'spam_mode_threshold') return '3';
        if (key === 'spam_mode_channel_id') return 'warn-channel-123';
        return null;
      });

      // Need to simulate finding a warning channel
      const mockWarnChannel = {
        name: 'spam-warnings',
        send: jest.fn().mockResolvedValue(true),
        permissionsFor: jest.fn().mockReturnValue({ has: () => true })
      };
      mockMessage.guild.channels.fetch.mockImplementation(async (id) => {
        if (id === 'warn-channel-123') return mockWarnChannel;
        if (id === mockMessage.channel.id) return mockMessage.channel;
        return null;
      });
      mockMessage.channel.messages = { fetch: jest.fn().mockResolvedValue(mockMessage) };

      // Send 1 message
      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockMessage.delete).not.toHaveBeenCalled();

      // Send 2nd identical message
      await spamModeUtils.trackNewUserMessage(mockMessage);
      expect(mockMessage.delete).not.toHaveBeenCalled();

      // Send 3rd identical message -> Spam detected
      await spamModeUtils.trackNewUserMessage(mockMessage);

      // Verify deletion
      expect(mockMessage.delete).toHaveBeenCalled();
      
      // Verify timeout
      expect(mockMessage.member.timeout).toHaveBeenCalledWith(600000, 'Spam detected: duplicate or similar messages');
      
      // Verify warning posted
      expect(mockWarnChannel.send).toHaveBeenCalled();
      
      // Verify DM sent
      expect(mockMessage.author.send).toHaveBeenCalled();
    });
  });

  describe('handleSpamWarningButton', () => {
    it('should ignore non-spam buttons', async () => {
      mockInteraction.customId = 'other:button';
      mockInteraction.isButton.mockReturnValue(true);
      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(false);
    });

    it('should reply with error if not in configured channel', async () => {
      mockInteraction.customId = 'spamWarn:dismiss';
      mockInteraction.isButton.mockReturnValue(true);
      mockInteraction.channelId = 'wrong-channel';
      mockDatabase.getValue.mockResolvedValue('right-channel');

      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(true);
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('These controls only work on spam alerts')
      }));
    });
    
    it('should allow dismissal by moderator', async () => {
      mockInteraction.customId = 'spamWarn:dismiss';
      mockInteraction.isButton.mockReturnValue(true);
      mockInteraction.channelId = 'right-channel';
      mockInteraction.member.permissions.has = jest.fn((perm) => perm === PermissionFlagsBits.ModerateMembers);
      mockDatabase.getValue.mockResolvedValue('right-channel');
      
      mockInteraction.message = { edit: jest.fn().mockResolvedValue(true) };

      const handled = await spamModeUtils.handleSpamWarningButton(mockInteraction);
      expect(handled).toBe(true);
      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockInteraction.message.edit).toHaveBeenCalledWith({ components: [] });
    });
  });
});
