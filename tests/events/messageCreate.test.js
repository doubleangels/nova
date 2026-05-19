const { Collection } = require('discord.js');

describe('messageCreate event', () => {
  let messageCreateEvent;
  let mockLogger;
  let mockInstrument;
  let mockDatabase;
  let mockReminderUtils;
  let mockMuteModeUtils;
  let mockSpamModeUtils;
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

    mockDatabase = {
      getValue: jest.fn(),
      removeMuteModeUser: jest.fn(),
      incrementMessageCount: jest.fn(),
      deleteMessageCount: jest.fn(),
      getMessageCount: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    mockReminderUtils = {
      handleReminder: jest.fn()
    };
    jest.doMock('../../utils/reminderUtils', () => mockReminderUtils);

    mockMuteModeUtils = {
      cancelMuteKick: jest.fn()
    };
    jest.doMock('../../utils/muteModeUtils', () => mockMuteModeUtils);

    mockSpamModeUtils = {
      trackNewUserMessage: jest.fn()
    };
    jest.doMock('../../utils/spamModeUtils', () => mockSpamModeUtils);

    mockConfig = {
      newMemberRoleId: 'role-noob',
      memberFrenRoleId: 'role-fren'
    };
    jest.doMock('../../config', () => mockConfig);

    messageCreateEvent = require('../../events/messageCreate');
  });

  describe('execute', () => {
    it('should fetch message if it is partial', async () => {
      const mockMessage = {
        partial: true,
        fetch: jest.fn().mockResolvedValue(),
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello'
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

      await messageCreateEvent.execute(mockMessage);

      expect(mockMessage.fetch).toHaveBeenCalled();
    });

    it('should catch fetch error, capture it, and throw custom error', async () => {
      const mockMessage = {
        partial: true,
        fetch: jest.fn().mockRejectedValue(new Error('Fetch fail')),
        author: { id: 'user-1' }
      };

      await expect(messageCreateEvent.execute(mockMessage)).rejects.toThrow('⚠️ Failed to fetch message content.');
      expect(mockInstrument.captureError).toHaveBeenCalled();
    });

    it('should call trackNewUserMessage if spam mode is enabled', async () => {
      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello'
      };

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        return null;
      });
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

      await messageCreateEvent.execute(mockMessage);

      expect(mockSpamModeUtils.trackNewUserMessage).toHaveBeenCalledWith(mockMessage);
    });

    it('should log error and not throw if trackNewUserMessage throws', async () => {
      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello'
      };

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        return null;
      });
      mockSpamModeUtils.trackNewUserMessage.mockRejectedValue(new Error('Spam track fail'));
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

      await messageCreateEvent.execute(mockMessage);

      expect(mockInstrument.captureError).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should remove mute mode tracking if cancelMuteKick is true', async () => {
      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello'
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(true);
      mockDatabase.removeMuteModeUser.mockResolvedValue();

      await messageCreateEvent.execute(mockMessage);

      expect(mockDatabase.removeMuteModeUser).toHaveBeenCalledWith('user-1');
    });

    it('should reply Pong! on !ping prefix command', async () => {
      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: '!ping',
        reply: jest.fn().mockResolvedValue()
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

      await messageCreateEvent.execute(mockMessage);

      expect(mockMessage.reply).toHaveBeenCalledWith('Pong!');
    });

    describe('no-text channel enforcement', () => {
      it('should delete message if in no-text channel and has no allowed content', async () => {
        const attachment1 = { url: 'document.pdf', contentType: 'application/pdf' };
        const attachmentsCollection = new Collection([['att-1', attachment1]]);

        const mockMessage = {
          partial: false,
          author: { id: 'user-1', tag: 'User#1234', bot: false },
          channel: { id: 'chan-notext', name: 'notext' },
          channelId: 'chan-notext',
          content: 'pure text message',
          attachments: attachmentsCollection,
          stickers: new Collection(),
          delete: jest.fn().mockResolvedValue()
        };

        mockDatabase.getValue.mockImplementation(async (key) => {
          if (key === 'notext_channel') return 'chan-notext';
          return null;
        });
        mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

        await messageCreateEvent.execute(mockMessage);

        // Cover line 127 mapping contentType
        expect(mockMessage.delete).toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Deleted message with no allowed content in no-text channel.'),
          expect.any(Object)
        );
      });

      it('should NOT delete if in no-text channel but has gif attachment or image', async () => {
        const attachmentGif = { url: 'image.gif', contentType: 'image/gif' };
        const mockMessage = {
          partial: false,
          author: { id: 'user-1', tag: 'User#1234', bot: false },
          channel: { id: 'chan-notext', name: 'notext' },
          channelId: 'chan-notext',
          content: 'text with gif attachment',
          attachments: new Collection([['gif-1', attachmentGif]]),
          stickers: new Collection(),
          delete: jest.fn()
        };

        mockDatabase.getValue.mockImplementation(async (key) => {
          if (key === 'notext_channel') return 'chan-notext';
          return null;
        });
        mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

        await messageCreateEvent.execute(mockMessage);

        expect(mockMessage.delete).not.toHaveBeenCalled();
      });

      it('should reply with error if delete fails', async () => {
        const mockMessage = {
          partial: false,
          author: { id: 'user-1', tag: 'User#1234', bot: false },
          channel: {
            id: 'chan-notext',
            name: 'notext',
            send: jest.fn().mockResolvedValue()
          },
          channelId: 'chan-notext',
          content: 'pure text message',
          attachments: new Collection(),
          stickers: new Collection(),
          delete: jest.fn().mockRejectedValue(new Error('Delete fail'))
        };

        mockDatabase.getValue.mockImplementation(async (key) => {
          if (key === 'notext_channel') return 'chan-notext';
          return null;
        });
        mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

        await messageCreateEvent.execute(mockMessage);

        expect(mockMessage.channel.send).toHaveBeenCalledWith({
          content: '⚠️ Failed to process the message.'
        });
        expect(mockInstrument.captureError).toHaveBeenCalled();
      });
    });

    describe('error throwing wrappers', () => {
      it('should throw specific wrapper errors', async () => {
        const mockMessage = {
          partial: false,
          author: { id: 'user-1', tag: 'User#1234', bot: false },
          channel: { id: 'chan-1', name: 'general' }
        };

        const errorCases = [
          ['⚠️ Failed to track message data.', '⚠️ Failed to track message data.'],
          ['⚠️ Failed to process bump message.', '⚠️ Failed to process bump message.'],
          ['⚠️ Database error occurred while processing message.', '⚠️ Database error occurred while processing message.'],
          ['⚠️ Insufficient permissions to process message.', '⚠️ Insufficient permissions to process message.'],
          ['⚠️ Invalid message data received.', '⚠️ Invalid message data received.'],
          ['⚠️ Failed to set reminder for bump message.', '⚠️ Failed to set reminder for bump message.'],
          ['generic error', '⚠️ An unexpected error occurred while processing the message.']
        ];

        for (const [errText, expectedMessage] of errorCases) {
          mockDatabase.getValue.mockRejectedValue(new Error(errText));
          await expect(messageCreateEvent.execute(mockMessage)).rejects.toThrow(expectedMessage);
        }
      });
    });
  });

  describe('processUserMessage role assignment', () => {
    it('should ignore if roles are not configured', async () => {
      mockConfig.newMemberRoleId = null;
      mockConfig.memberFrenRoleId = null;

      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello'
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

      await messageCreateEvent.execute(mockMessage);

      expect(mockDatabase.incrementMessageCount).not.toHaveBeenCalled();
    });

    it('should remove Noobies role and delete message count if member has Fren role', async () => {
      const mockMember = {
        roles: {
          cache: new Collection([
            ['role-fren', { id: 'role-fren' }],
            ['role-noob', { id: 'role-noob' }]
          ]),
          remove: jest.fn().mockResolvedValue()
        }
      };

      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello',
        member: mockMember
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);
      mockDatabase.getMessageCount.mockResolvedValue(10);
      mockDatabase.deleteMessageCount.mockResolvedValue();

      await messageCreateEvent.execute(mockMessage);

      expect(mockMember.roles.remove).toHaveBeenCalledWith('role-noob', expect.any(String));
      expect(mockDatabase.deleteMessageCount).toHaveBeenCalledWith('user-1');
    });

    it('should add Noobies role if message count < 100 and member lacks role', async () => {
      const mockMember = {
        roles: {
          cache: new Collection([]),
          add: jest.fn().mockResolvedValue()
        }
      };

      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello',
        member: mockMember
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);
      mockDatabase.incrementMessageCount.mockResolvedValue(50);

      await messageCreateEvent.execute(mockMessage);

      expect(mockMember.roles.add).toHaveBeenCalledWith('role-noob', expect.any(String));
    });

    it('should remove Noobies role and delete message count if message count >= 100 and member has role', async () => {
      const mockMember = {
        roles: {
          cache: new Collection([
            ['role-noob', { id: 'role-noob' }]
          ]),
          remove: jest.fn().mockResolvedValue()
        }
      };

      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello',
        member: mockMember
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);
      mockDatabase.incrementMessageCount.mockResolvedValue(100);
      mockDatabase.deleteMessageCount.mockResolvedValue();

      await messageCreateEvent.execute(mockMessage);

      expect(mockMember.roles.remove).toHaveBeenCalledWith('role-noob', expect.any(String));
      expect(mockDatabase.deleteMessageCount).toHaveBeenCalledWith('user-1');
    });

    it('should return early if incrementMessageCount returns null', async () => {
      const mockMember = {
        roles: {
          cache: new Collection([]),
          add: jest.fn()
        }
      };

      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello',
        member: mockMember
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);
      mockDatabase.incrementMessageCount.mockResolvedValue(null);

      await messageCreateEvent.execute(mockMessage);

      expect(mockMember.roles.add).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping New Member role check due to message count DB error.'),
        expect.any(Object)
      );
    });

    it('should catch roles assignment errors and log them without throwing', async () => {
      const mockMember = {
        roles: {
          cache: new Collection([]),
          add: jest.fn().mockRejectedValue(new Error('Add role fail'))
        }
      };

      const mockMessage = {
        partial: false,
        author: { id: 'user-1', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'hello',
        member: mockMember
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);
      mockDatabase.incrementMessageCount.mockResolvedValue(50);

      await expect(messageCreateEvent.execute(mockMessage)).resolves.not.toThrow();

      expect(mockInstrument.captureError).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error handling role assignment in processUserMessage.'),
        expect.any(Object)
      );
    });
  });

  describe('checkForBumpMessages', () => {
    it('should process Disboard bump embed', async () => {
      const mockMessage = {
        partial: false,
        author: { id: 'disboard-123', tag: 'Disboard#0000', bot: true },
        channel: { id: 'chan-1', name: 'general' },
        content: '',
        embeds: [{
          description: 'Bump done! Server bumped!'
        }]
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);
      mockReminderUtils.handleReminder.mockResolvedValue();

      await messageCreateEvent.execute(mockMessage);

      expect(mockReminderUtils.handleReminder).toHaveBeenCalledWith(mockMessage, 7200000, 'bump');
    });

    it('should fetch full message if embeds description is missing', async () => {
      const mockMessage = {
        partial: false,
        author: { id: 'disboard-123', tag: 'Disboard#0000', bot: true },
        channel: { id: 'chan-1', name: 'general' },
        content: '',
        embeds: [{
          title: 'Some embed'
        }],
        fetch: jest.fn().mockResolvedValue({
          embeds: [{
            description: 'Bump done! Server bumped!'
          }]
        })
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);
      mockReminderUtils.handleReminder.mockResolvedValue();

      await messageCreateEvent.execute(mockMessage);

      expect(mockMessage.fetch).toHaveBeenCalled();
      expect(mockReminderUtils.handleReminder).toHaveBeenCalledWith(mockMessage, 7200000, 'bump');
    });

    it('should handle fetch rejection gracefully when embeds description is missing', async () => {
      const mockMessage = {
        partial: false,
        author: { id: 'disboard-123', tag: 'Disboard#0000', bot: true },
        channel: { id: 'chan-1', name: 'general' },
        content: '',
        embeds: [{
          title: 'Some embed'
        }],
        fetch: jest.fn().mockRejectedValue(new Error('Discord API disconnect'))
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

      await messageCreateEvent.execute(mockMessage);

      // Cover line 271
      expect(mockMessage.fetch).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch message for Disboard check.'),
        expect.any(Object)
      );
    });

    it('should log debug when no embeds are available for Disboard check', async () => {
      let embedsCallCount = 0;
      const mockMessage = {
        partial: false,
        author: { id: 'user-123', tag: 'User#1234', bot: false },
        channel: { id: 'chan-1', name: 'general' },
        content: 'Just normal message',
        get embeds() {
          embedsCallCount++;
          if (embedsCallCount === 1) {
            return [{ title: 'Some Embed' }];
          }
          return [];
        }
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

      await messageCreateEvent.execute(mockMessage);

      // Cover lines 292-298
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No message embeds available for Disboard check.'),
        expect.any(Object)
      );
    });

    it('should catch error and log it if checkForBumpMessages throws globally', async () => {
      let embedsCallCount = 0;
      const mockMessage = {
        partial: false,
        author: { id: 'disboard-123', tag: 'Disboard#0000', bot: true },
        channel: { id: 'chan-1', name: 'general' },
        content: '',
        get embeds() {
          embedsCallCount++;
          if (embedsCallCount <= 3) {
            return [{ title: 'Some Embed' }];
          }
          throw new Error('Embeds getter crashed inside checkForBumpMessages try block');
        }
      };

      mockDatabase.getValue.mockResolvedValue(false);
      mockMuteModeUtils.cancelMuteKick.mockReturnValue(false);

      await expect(messageCreateEvent.execute(mockMessage)).resolves.not.toThrow();

      // Cover lines 300-307
      expect(mockInstrument.captureError).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to process bump message.', expect.any(Object));
    });
  });
});
