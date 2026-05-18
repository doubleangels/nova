const { createMockInteraction } = require('../testUtils');

describe('trollMode command', () => {
  let trollModeCommand;
  let mockDatabase;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);
    jest.doMock('../../config', () => ({}));

    mockDatabase = {
      getValue: jest.fn(),
      setValue: jest.fn()
    };
    jest.doMock('../../utils/database', () => mockDatabase);

    trollModeCommand = require('../../commands/trollMode');
  });

  describe('execute', () => {
    it('should defer reply with Ephemeral flags', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      mockDatabase.getValue.mockResolvedValueOnce(true); // enabled
      mockDatabase.getValue.mockResolvedValueOnce(30);   // account_age

      await trollModeCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 }); // MessageFlags.Ephemeral is 64 (1 << 6)
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should call handleStatusSubcommand when status subcommand is provided', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      mockDatabase.getValue.mockResolvedValueOnce(true);
      mockDatabase.getValue.mockResolvedValueOnce(30);

      const statusSpy = jest.spyOn(trollModeCommand, 'handleStatusSubcommand');

      await trollModeCommand.execute(mockInteraction);

      expect(statusSpy).toHaveBeenCalledWith(mockInteraction);
      statusSpy.mockRestore();
    });

    it('should call handleSetSubcommand when set subcommand is provided', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('set'),
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(15)
        }
      });

      mockDatabase.getValue.mockResolvedValueOnce(false); // current enabled
      mockDatabase.getValue.mockResolvedValueOnce(30);    // current age
      mockDatabase.setValue.mockResolvedValue(true);

      const setSpy = jest.spyOn(trollModeCommand, 'handleSetSubcommand');

      await trollModeCommand.execute(mockInteraction);

      expect(setSpy).toHaveBeenCalledWith(mockInteraction);
      expect(mockDatabase.setValue).toHaveBeenCalledWith('troll_mode_enabled', true);
      expect(mockDatabase.setValue).toHaveBeenCalledWith('troll_mode_account_age', 15);
      setSpy.mockRestore();
    });

    it('should handle errors in execute and call handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      const error = new Error('DATABASE_READ_ERROR');
      mockDatabase.getValue.mockRejectedValue(error);

      const errorSpy = jest.spyOn(trollModeCommand, 'handleError');

      await trollModeCommand.execute(mockInteraction);

      expect(errorSpy).toHaveBeenCalledWith(mockInteraction, error);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve troll mode settings. Please try again later.'
      }));
      errorSpy.mockRestore();
    });
  });

  describe('handleStatusSubcommand', () => {
    it('should fetch database values and editReply with an embed when enabled', async () => {
      const mockInteraction = createMockInteraction();
      mockDatabase.getValue.mockResolvedValueOnce(true); // enabled
      mockDatabase.getValue.mockResolvedValueOnce(30);   // accountAge

      await trollModeCommand.handleStatusSubcommand(mockInteraction);

      expect(mockDatabase.getValue).toHaveBeenCalledWith('troll_mode_enabled');
      expect(mockDatabase.getValue).toHaveBeenCalledWith('troll_mode_account_age');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Troll Mode Status');
      expect(embed.data.color).toBe(0x00FF00); // Green when enabled
    });

    it('should editReply with a red embed when disabled', async () => {
      const mockInteraction = createMockInteraction();
      mockDatabase.getValue.mockResolvedValueOnce(false); // enabled
      mockDatabase.getValue.mockResolvedValueOnce(1);     // accountAge

      await trollModeCommand.handleStatusSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Troll Mode Status');
      expect(embed.data.color).toBe(0xFF0000); // Red when disabled
    });
  });

  describe('handleSetSubcommand', () => {
    it('should update database settings and editReply', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(45)
        }
      });

      mockDatabase.getValue.mockResolvedValueOnce(false);
      mockDatabase.getValue.mockResolvedValueOnce(30);
      mockDatabase.setValue.mockResolvedValue(true);

      await trollModeCommand.handleSetSubcommand(mockInteraction);

      expect(mockDatabase.setValue).toHaveBeenCalledWith('troll_mode_enabled', true);
      expect(mockDatabase.setValue).toHaveBeenCalledWith('troll_mode_account_age', 45);
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should default to current settings if age option is not provided', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getInteger: jest.fn().mockReturnValue(null)
        }
      });

      mockDatabase.getValue.mockResolvedValueOnce(true); // current enabled
      mockDatabase.getValue.mockResolvedValueOnce(20);   // current age
      mockDatabase.setValue.mockResolvedValue(true);

      await trollModeCommand.handleSetSubcommand(mockInteraction);

      expect(mockDatabase.setValue).toHaveBeenCalledWith('troll_mode_enabled', false);
      expect(mockDatabase.setValue).not.toHaveBeenCalledWith('troll_mode_account_age', expect.any(Number));
    });
  });

  describe('getCurrentSettings', () => {
    it('should return correct object and parsed number for accountAge', async () => {
      mockDatabase.getValue.mockResolvedValueOnce(true);
      mockDatabase.getValue.mockResolvedValueOnce('45');

      const settings = await trollModeCommand.getCurrentSettings();
      expect(settings).toEqual({ enabled: true, accountAge: 45 });
    });

    it('should default to 30 if accountAge is not in DB', async () => {
      mockDatabase.getValue.mockResolvedValueOnce(false);
      mockDatabase.getValue.mockResolvedValueOnce(null);

      const settings = await trollModeCommand.getCurrentSettings();
      expect(settings).toEqual({ enabled: false, accountAge: 30 });
    });

    it('should throw DATABASE_READ_ERROR when DB read fails', async () => {
      mockDatabase.getValue.mockRejectedValue(new Error('connection error'));
      await expect(trollModeCommand.getCurrentSettings()).rejects.toThrow('DATABASE_READ_ERROR');
    });
  });

  describe('updateSettings', () => {
    it('should update database values', async () => {
      mockDatabase.setValue.mockResolvedValue(true);
      await trollModeCommand.updateSettings({ enabled: true, accountAge: 12 });
      expect(mockDatabase.setValue).toHaveBeenCalledWith('troll_mode_enabled', true);
      expect(mockDatabase.setValue).toHaveBeenCalledWith('troll_mode_account_age', 12);
    });

    it('should throw DATABASE_WRITE_ERROR when DB write fails', async () => {
      mockDatabase.setValue.mockRejectedValue(new Error('fail'));
      await expect(trollModeCommand.updateSettings({ enabled: true })).rejects.toThrow('DATABASE_WRITE_ERROR');
    });
  });

  describe('handleError', () => {
    it('should output DATABASE_WRITE_ERROR correctly', async () => {
      const mockInteraction = createMockInteraction();
      await trollModeCommand.handleError(mockInteraction, new Error('DATABASE_WRITE_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to update troll mode settings. Please try again later.'
      }));
    });

    it('should handle PERMISSION_DENIED error correctly', async () => {
      const mockInteraction = createMockInteraction();
      await trollModeCommand.handleError(mockInteraction, new Error('PERMISSION_DENIED'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ You don't have permission to manage troll mode settings."
      }));
    });

    it('should handle INVALID_SETTINGS error correctly', async () => {
      const mockInteraction = createMockInteraction();
      await trollModeCommand.handleError(mockInteraction, new Error('INVALID_SETTINGS'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Invalid troll mode settings provided.'
      }));
    });

    it('should try standard reply if editReply fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('no edit'));
      mockInteraction.reply = jest.fn().mockResolvedValue({});

      await trollModeCommand.handleError(mockInteraction, new Error('PERMISSION_DENIED'));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ You don't have permission to manage troll mode settings."
      }));
    });
  });
});
