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

  it('should serialize slash command subcommands', () => {
    const json = spamModeCommand.data.toJSON();
    expect(json.options.length).toBeGreaterThanOrEqual(2);
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

  describe('getCurrentSettings', () => {
    it('should default tracking window from mute mode kick time', async () => {
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'mute_mode_kick_time_hours') return '6';
        return null;
      });

      const settings = await spamModeCommand.getCurrentSettings();
      expect(settings.window).toBe(6);
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

    it('should show channel ID when warning channel is not in guild cache', async () => {
      const mockInteraction = createMockInteraction({
        guild: {
          channels: {
            cache: new Collection()
          }
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        if (key === 'spam_mode_threshold') return '3';
        if (key === 'spam_mode_window_hours') return '2';
        if (key === 'spam_mode_channel_id') return 'ch-missing';
        return null;
      });

      await spamModeCommand.handleStatusSubcommand(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const warningField = embed.data.fields.find(f => f.name === 'Warning Channel');
      expect(warningField.value).toBe('<#ch-missing>');
    });

    it('should display status when enabled with 1 hour singular form and no warning channel', async () => {
      const mockInteraction = createMockInteraction({
        guild: {
          channels: {
            cache: new Collection()
          }
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        if (key === 'spam_mode_threshold') return '3';
        if (key === 'spam_mode_window_hours') return '1';
        if (key === 'spam_mode_channel_id') return null;
        return null;
      });

      await spamModeCommand.handleStatusSubcommand(mockInteraction);

      // Cover line 278
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toBe('Spam configuration is incomplete.');
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

    it('should recover displayWarningChannel from guild cache when not provided as option but set in db', async () => {
      const mockChannel = { id: 'ch-db-warn', toString: () => '<#ch-db-warn>' };
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockImplementation((name) => {
            if (name === 'threshold') return 3;
            if (name === 'window') return 1; // 1 hour singular form
            return null;
          }),
          getChannel: jest.fn().mockReturnValue(null) // not provided
        },
        guild: {
          channels: {
            cache: new Collection([['ch-db-warn', mockChannel]])
          }
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        if (key === 'spam_mode_threshold') return '3';
        if (key === 'spam_mode_window_hours') return '4';
        if (key === 'spam_mode_channel_id') return 'ch-db-warn';
        return null;
      });

      await spamModeCommand.handleSetSubcommand(mockInteraction);

      // Cover line 148
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const warningField = embed.data.fields.find(f => f.name === 'Warning Channel');
      expect(warningField.value).toBe('<#ch-db-warn>');
    });

    it('should set spam mode to enabled but with incomplete warning channel settings', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getBoolean: jest.fn().mockReturnValue(true),
          getInteger: jest.fn().mockImplementation((name) => {
            if (name === 'threshold') return 3;
            if (name === 'window') return 12;
            return null;
          }),
          getChannel: jest.fn().mockReturnValue(null) // not provided
        },
        guild: {
          channels: {
            cache: new Collection()
          }
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return true;
        if (key === 'spam_mode_threshold') return '3';
        if (key === 'spam_mode_window_hours') return '4';
        if (key === 'spam_mode_channel_id') return null; // not set
        return null;
      });

      await spamModeCommand.handleSetSubcommand(mockInteraction);

      // Cover line 315
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toBe('Spam configuration is incomplete.');
    });
  });

  describe('formatStatusMessage and formatUpdateMessage', () => {
    it('should show full description when enabled with warning channel configured', () => {
      const mockChannel = { toString: () => '<#warn-ch>' };
      const mockInteraction = createMockInteraction({
        guild: {
          channels: {
            cache: new Map([['warn-ch', mockChannel]])
          }
        }
      });

      const statusEmbed = spamModeCommand.formatStatusMessage({
        enabled: true,
        threshold: 3,
        window: 1,
        warningChannelId: 'warn-ch'
      }, mockInteraction);
      expect(statusEmbed.data.description).toContain('duplicate messages');
      expect(statusEmbed.data.description).toContain('**1** hour');

      const updateEmbed = spamModeCommand.formatUpdateMessage(
        true,
        3,
        2,
        mockChannel,
        mockInteraction
      );
      expect(updateEmbed.data.description).toContain('duplicate messages');
    });

    it('should use plural hours in formatUpdateMessage when window is not 1', () => {
      const mockInteraction = createMockInteraction();
      const embed = spamModeCommand.formatUpdateMessage(true, 5, 4, null, mockInteraction);
      const windowField = embed.data.fields.find(f => f.name === 'Tracking Window');
      expect(windowField.value).toBe('4 hours');
    });
  });

  describe('getCurrentSettings', () => {
    it('should default window when mute kick time is not a number', async () => {
      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'spam_mode_enabled') return false;
        if (key === 'spam_mode_threshold') return null;
        if (key === 'spam_mode_window_hours') return null;
        if (key === 'mute_mode_kick_time_hours') return 'not-a-number';
        return null;
      });

      const settings = await spamModeCommand.getCurrentSettings();
      expect(settings.window).toBe(4);
    });

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

    it('should reply with correct message for DATABASE_READ_ERROR', async () => {
      const mockInteraction = createMockInteraction();
      await spamModeCommand.handleError(mockInteraction, new Error('DATABASE_READ_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve spam mode settings. Please try again later.'
      }));
    });

    it('should reply with correct message for DATABASE_WRITE_ERROR', async () => {
      const mockInteraction = createMockInteraction();
      await spamModeCommand.handleError(mockInteraction, new Error('DATABASE_WRITE_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to update spam mode settings. Please try again later.'
      })); // Cover line 344
    });

    it('should reply with correct message for PERMISSION_DENIED', async () => {
      const mockInteraction = createMockInteraction();
      await spamModeCommand.handleError(mockInteraction, new Error('PERMISSION_DENIED'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: "⚠️ You don't have permission to manage spam mode settings."
      })); // Cover line 346
    });

    it('should reply with correct message for INVALID_SETTINGS', async () => {
      const mockInteraction = createMockInteraction();
      await spamModeCommand.handleError(mockInteraction, new Error('INVALID_SETTINGS'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Invalid spam mode settings provided.'
      })); // Cover line 348
    });

    it('should fallback to reply if editReply throws an error inside handleError', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('Discord interaction failed'));

      await spamModeCommand.handleError(mockInteraction, new Error('DATABASE_READ_ERROR'));

      // Cover lines 357-363
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for spammode command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve spam mode settings. Please try again later.'
      }));
    });

    it('should swallow errors when both editReply and reply fail', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('edit failed'));
      mockInteraction.reply.mockRejectedValue(new Error('reply failed'));

      await expect(
        spamModeCommand.handleError(mockInteraction, new Error('DATABASE_READ_ERROR'))
      ).resolves.not.toThrow();
    });
  });
});
