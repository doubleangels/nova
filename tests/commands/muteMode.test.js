const { createMockInteraction } = require('../testUtils');

describe('muteMode command', () => {
  let muteModeCommand;
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

    muteModeCommand = require('../../commands/muteMode');
  });

  describe('execute', () => {
    it('should defer reply and call handleStatusSubcommand when subcommand is status', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      mockDatabase.getValue.mockResolvedValue(true); // enabled

      const statusSpy = jest.spyOn(muteModeCommand, 'handleStatusSubcommand').mockResolvedValue();

      await muteModeCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
      expect(statusSpy).toHaveBeenCalledWith(mockInteraction);
      statusSpy.mockRestore();
    });

    it('should call handleSetSubcommand when subcommand is set', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('set'),
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(12)
        }
      });

      mockDatabase.getValue.mockResolvedValue(true);
      const setSpy = jest.spyOn(muteModeCommand, 'handleSetSubcommand').mockResolvedValue();

      await muteModeCommand.execute(mockInteraction);

      expect(setSpy).toHaveBeenCalledWith(mockInteraction);
      setSpy.mockRestore();
    });

    it('should handle errors using handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      const error = new Error('DATABASE_READ_ERROR');
      mockDatabase.getValue.mockRejectedValue(error);

      const errorSpy = jest.spyOn(muteModeCommand, 'handleError').mockResolvedValue();

      await muteModeCommand.execute(mockInteraction);

      expect(errorSpy).toHaveBeenCalledWith(mockInteraction, error);
      errorSpy.mockRestore();
    });
  });

  describe('handleStatusSubcommand', () => {
    it('should retrieve status, construct embed, and editReply when enabled', async () => {
      const mockInteraction = createMockInteraction();
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return true;
        if (key === 'mute_mode_kick_time_hours') return '12';
        return null;
      });

      await muteModeCommand.handleStatusSubcommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Mute Mode Status');
      expect(embed.data.color).toBe(0x00FF00); // Green when enabled
      const statusField = embed.data.fields.find(f => f.name === 'Status');
      expect(statusField.value).toBe('**Enabled**');
    });

    it('should retrieve status with 1 hour singular form when enabled with limit of 1', async () => {
      const mockInteraction = createMockInteraction();
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return true;
        if (key === 'mute_mode_kick_time_hours') return '1';
        return null;
      });

      await muteModeCommand.handleStatusSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const timeField = embed.data.fields.find(f => f.name === 'Time Limit');
      expect(timeField.value).toBe('1 hour');
    });

    it('should construct disabled status embed when disabled', async () => {
      const mockInteraction = createMockInteraction();
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return false;
        if (key === 'mute_mode_kick_time_hours') return '1';
        return null;
      });

      await muteModeCommand.handleStatusSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0xFF0000); // Red when disabled
      const statusField = embed.data.fields.find(f => f.name === 'Status');
      expect(statusField.value).toBe('**Disabled**');
    });
  });

  describe('handleSetSubcommand', () => {
    it('should set settings and reply with embed', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(24)
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return false;
        if (key === 'mute_mode_kick_time_hours') return '2';
        return null;
      });

      await muteModeCommand.handleSetSubcommand(mockInteraction);

      expect(mockDatabase.setValue).toHaveBeenCalledWith('mute_mode_enabled', true);
      expect(mockDatabase.setValue).toHaveBeenCalledWith('mute_mode_kick_time_hours', 24);
      expect(mockInteraction.editReply).toHaveBeenCalled();

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Mute Mode Updated');
      const timeField = embed.data.fields.find(f => f.name === 'Time Limit');
      expect(timeField.value).toBe('2 hours → 24 hours');
    });

    it('should handle set settings when time limits are 1 hour singular form', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(1)
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return false;
        if (key === 'mute_mode_kick_time_hours') return '1';
        return null;
      });

      await muteModeCommand.handleSetSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const timeField = embed.data.fields.find(f => f.name === 'Time Limit');
      expect(timeField.value).toBe('1 hour');
    });

    it('should set settings when time limits are unchanged but status changes', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(2)
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return false;
        if (key === 'mute_mode_kick_time_hours') return '2';
        return null;
      });

      await muteModeCommand.handleSetSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const timeField = embed.data.fields.find(f => f.name === 'Time Limit');
      expect(timeField.value).toBe('2 hours');
    });

    it('should enforce default value on invalid time limit', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(100) // invalid (> 72)
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return true;
        if (key === 'mute_mode_kick_time_hours') return '2';
        return null;
      });

      await muteModeCommand.handleSetSubcommand(mockInteraction);

      expect(mockDatabase.setValue).toHaveBeenCalledWith('mute_mode_kick_time_hours', 2);
    });

    it('should throw error inside catch block if updateSettings throws (rethrow covered)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('set'),
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(2)
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_enabled') return true;
        if (key === 'mute_mode_kick_time_hours') return '2';
        return null;
      });

      mockDatabase.setValue.mockRejectedValue(new Error('db error'));

      const spy = jest.spyOn(muteModeCommand, 'handleError').mockResolvedValue();

      await muteModeCommand.execute(mockInteraction);

      // Cover line 156 rethrow caught by execute
      expect(spy).toHaveBeenCalledWith(mockInteraction, expect.any(Error));
      spy.mockRestore();
    });
  });

  describe('getCurrentSettings', () => {
    it('should throw DATABASE_READ_ERROR when DB read fails', async () => {
      mockDatabase.getValue.mockRejectedValue(new Error('db connection error'));
      await expect(muteModeCommand.getCurrentSettings()).rejects.toThrow('DATABASE_READ_ERROR');
    });
  });

  describe('updateSettings', () => {
    it('should throw DATABASE_WRITE_ERROR when DB write fails', async () => {
      mockDatabase.setValue.mockRejectedValue(new Error('db write error'));
      await expect(muteModeCommand.updateSettings(true, 5)).rejects.toThrow('DATABASE_WRITE_ERROR');
    });
  });

  describe('handleError', () => {
    it('should output DATABASE_READ_ERROR correctly', async () => {
      const mockInteraction = createMockInteraction();
      await muteModeCommand.handleError(mockInteraction, new Error('DATABASE_READ_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve mute mode settings. Please try again later.'
      }));
    });

    it('should output DATABASE_WRITE_ERROR correctly', async () => {
      const mockInteraction = createMockInteraction();
      await muteModeCommand.handleError(mockInteraction, new Error('DATABASE_WRITE_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to update mute mode settings. Please try again later.'
      })); // Cover line 288
    });

    it('should handle INVALID_TIME_LIMIT error correctly', async () => {
      const mockInteraction = createMockInteraction();
      await muteModeCommand.handleError(mockInteraction, new Error('INVALID_TIME_LIMIT'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Invalid time limit specified. Using default value.'
      }));
    });

    it('should handle unexpected errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      await muteModeCommand.handleError(mockInteraction, new Error('some random error'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while managing mute mode. Please try again later.'
      }));
    });

    it('should fallback to reply if editReply throws an error inside handleError', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('Discord API error'));

      await muteModeCommand.handleError(mockInteraction, new Error('DATABASE_WRITE_ERROR'));

      // Cover lines 299-305
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for mutemode command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to update mute mode settings. Please try again later.'
      }));
    });
  });
});
