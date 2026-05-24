const { createMockInteraction, createMockRole } = require('../testUtils');

describe('changeColor command', () => {
  let changeColorCommand;
  let mockLogger;
  let mockColorUtils;
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

    mockColorUtils = {
      validateAndNormalizeColor: jest.fn()
    };
    jest.doMock('../../utils/colorUtils', () => mockColorUtils);

    mockConfig = {
      baseEmbedColor: '#c03728'
    };
    jest.doMock('../../config', () => mockConfig);

    changeColorCommand = require('../../commands/changeColor');
  });

  it('should serialize slash command options', () => {
    const json = changeColorCommand.data.toJSON();
    expect(json.name).toBe('changecolor');
    expect(json.options).toHaveLength(2);
  });

  describe('execute', () => {
    it('should successfully change the color of a role', async () => {
      const mockRole = createMockRole({
        id: 'role-color',
        hexColor: '#123456',
        setColor: jest.fn().mockResolvedValue(true)
      });

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue('#ff0000')
        },
        guild: {
          members: {
            me: {
              permissions: {
                has: jest.fn().mockReturnValue(true) // BOT_PERMISSION_DENIED is false
              }
            }
          }
        }
      });

      mockColorUtils.validateAndNormalizeColor.mockReturnValue({
        success: true,
        normalizedColor: '#ff0000'
      });

      await changeColorCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
      expect(mockRole.setColor).toHaveBeenCalledWith('#ff0000');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Role Color Updated');
      expect(embed.data.color).toBe(0xff0000);
    });

    it('should throw INVALID_COLOR error if color validation fails', async () => {
      const mockRole = createMockRole({ id: 'role-color', hexColor: '#123456' });
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue('invalid-color')
        }
      });

      mockColorUtils.validateAndNormalizeColor.mockReturnValue({ success: false });

      await changeColorCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Invalid color format. Please provide a valid hex color code (e.g., #FF0000).'
      }));
    });

    it('should throw BOT_PERMISSION_DENIED error if bot lacks permissions', async () => {
      const mockRole = createMockRole({ id: 'role-color', hexColor: '#123456' });
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue('#ff0000')
        },
        guild: {
          members: {
            me: {
              permissions: {
                has: jest.fn().mockReturnValue(false)
              }
            }
          }
        }
      });

      mockColorUtils.validateAndNormalizeColor.mockReturnValue({
        success: true,
        normalizedColor: '#ff0000'
      });

      await changeColorCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ I don't have permission to manage roles in this server."
      }));
    });

    it('should map ROLE_NOT_MANAGEABLE error message', async () => {
      const mockRole = createMockRole({
        id: 'role-color',
        hexColor: '#123456',
        setColor: jest.fn().mockRejectedValue(new Error('ROLE_NOT_MANAGEABLE'))
      });

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue('#ff0000')
        },
        guild: {
          members: {
            me: {
              permissions: {
                has: jest.fn().mockReturnValue(true)
              }
            }
          }
        }
      });

      mockColorUtils.validateAndNormalizeColor.mockReturnValue({
        success: true,
        normalizedColor: '#ff0000'
      });

      await changeColorCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ I cannot modify this role. It may be managed by an integration or have higher permissions than me.'
      }));
    });

    it('should catch generic error during setColor and send appropriate message', async () => {
      const mockRole = createMockRole({
        id: 'role-color',
        hexColor: '#123456',
        setColor: jest.fn().mockRejectedValue(new Error('DiscordAPIError: Missing Permissions'))
      });

      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue('#ff0000')
        },
        guild: {
          members: {
            me: {
              permissions: {
                has: jest.fn().mockReturnValue(true)
              }
            }
          }
        }
      });

      mockColorUtils.validateAndNormalizeColor.mockReturnValue({
        success: true,
        normalizedColor: '#ff0000'
      });

      await changeColorCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred. Please try again later.'
      }));
    });

    it('should fall back to reply if editReply fails', async () => {
      const mockRole = createMockRole({ id: 'role-color', hexColor: '#123456' });
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue('#ff0000')
        }
      });

      mockInteraction.editReply.mockRejectedValue(new Error('edit failed'));
      mockInteraction.reply = jest.fn().mockResolvedValue(true);
      mockColorUtils.validateAndNormalizeColor.mockReturnValue({ success: false });

      await changeColorCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array),
        flags: 64
      }));
    });

    it('should swallow errors when both editReply and reply fail in error handler', async () => {
      const mockRole = createMockRole({ id: 'role-color', hexColor: '#123456' });
      const mockInteraction = createMockInteraction({
        options: {
          getRole: jest.fn().mockReturnValue(mockRole),
          getString: jest.fn().mockReturnValue('#ff0000')
        }
      });

      mockInteraction.editReply.mockRejectedValue(new Error('edit failed'));
      mockInteraction.reply = jest.fn().mockRejectedValue(new Error('reply failed'));
      mockColorUtils.validateAndNormalizeColor.mockReturnValue({ success: false });

      await expect(changeColorCommand.execute(mockInteraction)).resolves.not.toThrow();
    });
  });
});
