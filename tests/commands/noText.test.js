const { createMockInteraction: originalCreateMockInteraction } = require('../testUtils');

function createMockInteraction(overrides = {}) {
  return originalCreateMockInteraction({
    client: { user: { id: 'bot-123' } },
    ...overrides
  });
}

describe('noText command', () => {
  let noTextCommand;
  let mockDatabase;
  let mockLogger;
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

    mockConfig = {
      baseEmbedColor: '#c03728'
    };
    jest.doMock('../../config', () => mockConfig);

    mockDatabase = {
      getValue: jest.fn(),
      setValue: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    noTextCommand = require('../../commands/noText');
  });

  describe('execute', () => {
    it('should show error if channel is missing', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('set'),
          getChannel: jest.fn().mockReturnValue(null)
        }
      });

      await noTextCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please select a text channel.'
      }));
    });

    it('should show error if client has no ManageMessages permission', async () => {
      const mockChannel = {
        id: 'ch-text',
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(false)
        })
      };

      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('set'),
          getChannel: jest.fn().mockReturnValue(mockChannel)
        }
      });

      await noTextCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ I need permission to manage messages in the selected channel.'
      }));
    });

    describe('subcommand set', () => {
      it('should return error if channel already configured', async () => {
        const mockChannel = {
          id: 'ch-text',
          toString: () => '<#ch-text>',
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true)
          })
        };

        const mockInteraction = createMockInteraction({
          options: {
            getSubcommand: jest.fn().mockReturnValue('set'),
            getChannel: jest.fn().mockReturnValue(mockChannel)
          }
        });

        mockDatabase.getValue.mockResolvedValue('ch-text');

        await noTextCommand.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: '⚠️ This channel is already configured as a no-text channel.'
        }));
      });

      it('should handle database error when setting configuration', async () => {
        const mockChannel = {
          id: 'ch-text',
          toString: () => '<#ch-text>',
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true)
          })
        };

        const mockInteraction = createMockInteraction({
          options: {
            getSubcommand: jest.fn().mockReturnValue('set'),
            getChannel: jest.fn().mockReturnValue(mockChannel)
          }
        });

        mockDatabase.getValue.mockResolvedValue('other-ch');
        mockDatabase.setValue.mockRejectedValue(new Error('fail'));

        await noTextCommand.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: '⚠️ Failed to save channel configuration. Please try again later.'
        }));
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should successfully set no-text channel config', async () => {
        const mockChannel = {
          id: 'ch-text',
          toString: () => '<#ch-text>',
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true)
          })
        };

        const mockInteraction = createMockInteraction({
          options: {
            getSubcommand: jest.fn().mockReturnValue('set'),
            getChannel: jest.fn().mockReturnValue(mockChannel)
          }
        });

        mockDatabase.getValue.mockResolvedValue(null);
        mockDatabase.setValue.mockResolvedValue(true);

        await noTextCommand.execute(mockInteraction);

        expect(mockDatabase.setValue).toHaveBeenCalledWith('notext_channel', 'ch-text');
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          embeds: expect.any(Array)
        }));
      });
    });

    describe('subcommand remove', () => {
      it('should return error if channel is not configured as no-text', async () => {
        const mockChannel = {
          id: 'ch-text',
          toString: () => '<#ch-text>',
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true)
          })
        };

        const mockInteraction = createMockInteraction({
          options: {
            getSubcommand: jest.fn().mockReturnValue('remove'),
            getChannel: jest.fn().mockReturnValue(mockChannel)
          }
        });

        mockDatabase.getValue.mockResolvedValue('other-ch');

        await noTextCommand.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: '⚠️ This channel is not configured as a no-text channel.'
        }));
      });

      it('should handle database error when removing configuration', async () => {
        const mockChannel = {
          id: 'ch-text',
          toString: () => '<#ch-text>',
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true)
          })
        };

        const mockInteraction = createMockInteraction({
          options: {
            getSubcommand: jest.fn().mockReturnValue('remove'),
            getChannel: jest.fn().mockReturnValue(mockChannel)
          }
        });

        mockDatabase.getValue.mockResolvedValue('ch-text');
        mockDatabase.setValue.mockRejectedValue(new Error('fail'));

        await noTextCommand.execute(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: '⚠️ Failed to save channel configuration. Please try again later.'
        }));
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should successfully remove no-text channel config', async () => {
        const mockChannel = {
          id: 'ch-text',
          toString: () => '<#ch-text>',
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true)
          })
        };

        const mockInteraction = createMockInteraction({
          options: {
            getSubcommand: jest.fn().mockReturnValue('remove'),
            getChannel: jest.fn().mockReturnValue(mockChannel)
          }
        });

        mockDatabase.getValue.mockResolvedValue('ch-text');
        mockDatabase.setValue.mockResolvedValue(true);

        await noTextCommand.execute(mockInteraction);

        expect(mockDatabase.setValue).toHaveBeenCalledWith('notext_channel', null);
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          embeds: expect.any(Array)
        }));
      });
    });

    it('should catch unexpected errors and send error message', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('set'),
          getChannel: jest.fn().mockImplementation(() => {
            throw new Error('Unexpected crash');
          })
        }
      });

      await noTextCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while configuring the channel. Please try again later.'
      }));
    });
  });
});
