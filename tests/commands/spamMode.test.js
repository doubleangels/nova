const { createMockInteraction } = require('../testUtils');
const { Collection } = require('discord.js');

describe('spamMode command', () => {
  let spamModeCommand;
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

    spamModeCommand = require('../../commands/spamMode');
  });

  describe('execute', () => {
    it('should defer reply with Ephemeral flags and call status subcommand', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      mockDatabase.getValue.mockResolvedValue(true); // enabled

      const statusSpy = jest.spyOn(spamModeCommand, 'handleStatusSubcommand').mockResolvedValue();

      await spamModeCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
      expect(statusSpy).toHaveBeenCalledWith(mockInteraction);
      statusSpy.mockRestore();
    });

    it('should call handleSetSubcommand when set is passed', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('set'),
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockReturnValue(null),
          getChannel: jest.fn().mockReturnValue(null)
        }
      });

      mockDatabase.getValue.mockResolvedValue(true);
      const setSpy = jest.spyOn(spamModeCommand, 'handleSetSubcommand').mockResolvedValue();

      await spamModeCommand.execute(mockInteraction);

      expect(setSpy).toHaveBeenCalledWith(mockInteraction);
      setSpy.mockRestore();
    });

    it('should call handleError on failure', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      const error = new Error('DATABASE_READ_ERROR');
      mockDatabase.getValue.mockRejectedValue(error);

      const errorSpy = jest.spyOn(spamModeCommand, 'handleError').mockResolvedValue();

      await spamModeCommand.execute(mockInteraction);

      expect(errorSpy).toHaveBeenCalledWith(mockInteraction, error);
      errorSpy.mockRestore();
    });
  });

  describe('handleStatusSubcommand', () => {
    it('should fetch status, construct embed and reply', async () => {
      const warningChannel = { id: 'ch-warn', toString: () => '<#ch-warn>' };
      const channelsCache = new Collection([['ch-warn', warningChannel]]);
      const mockInteraction = createMockInteraction({
        guild: {
          channels: {
            cache: channelsCache
          }
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        if (key === 'spam_mode_threshold') return '5';
        if (key === 'spam_mode_window_hours') return '12';
        if (key === 'spam_mode_channel_id') return 'ch-warn';
        return null;
      });

      await spamModeCommand.handleStatusSubcommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Spam Mode Status');
      expect(embed.data.color).toBe(0x00FF00); // Green when enabled
    });

    it('should handle missing warning channel when disabled', async () => {
      const mockInteraction = createMockInteraction({
        guild: {
          channels: {
            cache: new Collection()
          }
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return false;
        if (key === 'spam_mode_threshold') return '3';
        if (key === 'spam_mode_window_hours') return '2';
        if (key === 'spam_mode_channel_id') return null;
        return null;
      });

      await spamModeCommand.handleStatusSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.color).toBe(0xFF0000); // Red when disabled
      const warningField = embed.data.fields.find(f => f.name === 'Warning Channel');
      expect(warningField.value).toBe('⚠️ Not set!');
    });
  });

  describe('handleSetSubcommand', () => {
    it('should set settings and display update message', async () => {
      const mockChannel = { id: 'ch-new', toString: () => '<#ch-new>' };
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockImplementation((name) => {
            if (name === 'threshold') return 6;
            if (name === 'window') return 24;
            return null;
          }),
          getChannel: jest.fn().mockReturnValue(mockChannel)
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return false;
        if (key === 'spam_mode_threshold') return '3';
        if (key === 'spam_mode_window_hours') return '4';
        return null;
      });

      await spamModeCommand.handleSetSubcommand(mockInteraction);

      expect(mockDatabase.setValue).toHaveBeenCalledWith('spam_mode_enabled', true);
      expect(mockDatabase.setValue).toHaveBeenCalledWith('spam_mode_threshold', 6);
      expect(mockDatabase.setValue).toHaveBeenCalledWith('spam_mode_window_hours', 24);
      expect(mockDatabase.setValue).toHaveBeenCalledWith('spam_mode_channel_id', 'ch-new');
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should support resetting values by not passing optional parameters', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(false),
          getInteger: jest.fn().mockReturnValue(null),
          getChannel: jest.fn().mockReturnValue(null)
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        if (key === 'spam_mode_threshold') return '4';
        if (key === 'spam_mode_window_hours') return '10';
        return null;
      });

      await spamModeCommand.handleSetSubcommand(mockInteraction);

      expect(mockDatabase.setValue).toHaveBeenCalledWith('spam_mode_enabled', false);
      expect(mockDatabase.setValue).not.toHaveBeenCalledWith('spam_mode_threshold', expect.any(Number));
      expect(mockDatabase.setValue).not.toHaveBeenCalledWith('spam_mode_window_hours', expect.any(Number));
    });
  });

  describe('getCurrentSettings', () => {
    it('should default window to mute_mode_kick_time_hours if not set', async () => {
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        if (key === 'spam_mode_threshold') return null;
        if (key === 'spam_mode_window_hours') return null;
        if (key === 'spam_mode_channel_id') return null;
        if (key === 'mute_mode_kick_time_hours') return '48';
        return null;
      });

      const settings = await spamModeCommand.getCurrentSettings();
      expect(settings).toEqual({
        enabled: true,
        threshold: 3,
        window: 48,
        warningChannelId: null
      });
    });

    it('should throw DATABASE_READ_ERROR when DB read fails', async () => {
      mockDatabase.getValue.mockRejectedValue(new Error('connection failed'));
      await expect(spamModeCommand.getCurrentSettings()).rejects.toThrow('DATABASE_READ_ERROR');
    });
  });

  describe('updateSettings', () => {
    it('should remove warning channel setting if warningChannelId is null', async () => {
      await spamModeCommand.updateSettings({ warningChannelId: null });
      expect(mockDatabase.setValue).toHaveBeenCalledWith('spam_mode_channel_id', null);
    });

    it('should throw DATABASE_WRITE_ERROR when DB write fails', async () => {
      mockDatabase.setValue.mockRejectedValue(new Error('write failed'));
      await expect(spamModeCommand.updateSettings({ enabled: true })).rejects.toThrow('DATABASE_WRITE_ERROR');
    });
  });

  describe('handleError', () => {
    it('should send generic unexpected error message for standard errors', async () => {
      const mockInteraction = createMockInteraction();
      await spamModeCommand.handleError(mockInteraction, new Error('unexpected error'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while managing spam mode settings. Please try again later.'
      }));
    });
  });
});
