const { createMockInteraction } = require('../testUtils');
const { Collection, ChannelType } = require('discord.js');
const dayjs = require('dayjs');

describe('reminder command', () => {
  let reminderCommand;
  let mockDatabase;
  let mockLogger;
  let mockReminderUtils;

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

    mockReminderUtils = {
      getLatestReminderData: jest.fn()
    };
    jest.doMock('../../utils/reminderUtils', () => mockReminderUtils);

    reminderCommand = require('../../commands/reminder');
  });

  describe('execute', () => {
    it('should defer reply and handle setup subcommand', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('setup')
        }
      });

      const setupSpy = jest.spyOn(reminderCommand, 'handleReminderSetup').mockResolvedValue();

      await reminderCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
      expect(setupSpy).toHaveBeenCalledWith(mockInteraction);
      setupSpy.mockRestore();
    });

    it('should call handleReminderStatus when status subcommand is used', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      const statusSpy = jest.spyOn(reminderCommand, 'handleReminderStatus').mockResolvedValue();

      await reminderCommand.execute(mockInteraction);

      expect(statusSpy).toHaveBeenCalledWith(mockInteraction);
      statusSpy.mockRestore();
    });

    it('should handle errors in execute', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('status')
        }
      });

      const error = new Error('DATABASE_READ_ERROR');
      jest.spyOn(reminderCommand, 'handleReminderStatus').mockRejectedValue(error);
      const errorSpy = jest.spyOn(reminderCommand, 'handleError').mockResolvedValue();

      await reminderCommand.execute(mockInteraction);

      expect(errorSpy).toHaveBeenCalledWith(mockInteraction, error);
      errorSpy.mockRestore();
    });
  });

  describe('handleReminderSetup', () => {
    it('should update channel and role settings when channel is GuildText', async () => {
      const mockChannel = { id: 'ch-text', type: ChannelType.GuildText };
      const mockRole = { id: 'role-ping' };

      const mockInteraction = createMockInteraction({
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getRole: jest.fn().mockReturnValue(mockRole)
        }
      });

      mockDatabase.setValue.mockResolvedValue(true);

      await reminderCommand.handleReminderSetup(mockInteraction);

      expect(mockDatabase.setValue).toHaveBeenCalledWith('reminder_channel', 'ch-text');
      expect(mockDatabase.setValue).toHaveBeenCalledWith('reminder_role', 'role-ping');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should throw INVALID_CHANNEL_TYPE if channel is not GuildText', async () => {
      const mockChannel = { id: 'ch-voice', type: ChannelType.GuildVoice };
      const mockRole = { id: 'role-ping' };

      const mockInteraction = createMockInteraction({
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getRole: jest.fn().mockReturnValue(mockRole)
        }
      });

      await expect(reminderCommand.handleReminderSetup(mockInteraction)).rejects.toThrow('INVALID_CHANNEL_TYPE');
    });

    it('should throw DATABASE_WRITE_ERROR if database write fails', async () => {
      const mockChannel = { id: 'ch-text', type: ChannelType.GuildText };
      const mockRole = { id: 'role-ping' };

      const mockInteraction = createMockInteraction({
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getRole: jest.fn().mockReturnValue(mockRole)
        }
      });

      mockDatabase.setValue.mockRejectedValue(new Error('fail'));

      await expect(reminderCommand.handleReminderSetup(mockInteraction)).rejects.toThrow('DATABASE_WRITE_ERROR');
    });
  });

  describe('handleReminderStatus', () => {
    it('should fetch database values, calculate times, and editReply', async () => {
      const mockChannel = { id: 'ch-text', name: 'reminders' };
      const mockRole = { id: 'role-ping', name: 'pingme' };

      const mockInteraction = createMockInteraction({
        guild: {
          channels: {
            cache: new Collection([['ch-text', mockChannel]])
          },
          roles: {
            cache: new Collection([['role-ping', mockRole]])
          }
        }
      });

      mockDatabase.getValue.mockImplementation(async (key) => {
        if (key === 'reminder_channel') return 'ch-text';
        if (key === 'reminder_role') return 'role-ping';
        return null;
      });

      const futureTime = dayjs().add(2, 'hour').valueOf();
      mockReminderUtils.getLatestReminderData.mockResolvedValue({ remind_at: futureTime });

      await reminderCommand.handleReminderStatus(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalled();
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Server Reminders Status');
      
      const bumpField = embed.data.fields.find(f => f.name === 'Next Bump (Disboard)');
      expect(bumpField.value).toContain(`<t:${Math.floor(futureTime / 1000)}:R>`);
    });

    it('should handle configuration incomplete when not set', async () => {
      const mockInteraction = createMockInteraction({
        guild: {
          channels: { cache: new Collection() },
          roles: { cache: new Collection() }
        }
      });

      mockDatabase.getValue.mockResolvedValue(null);
      mockReminderUtils.getLatestReminderData.mockResolvedValue(null);

      await reminderCommand.handleReminderStatus(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toBe('Reminder configuration is incomplete.');
    });

    it('should throw DATABASE_READ_ERROR when DB read fails', async () => {
      const mockInteraction = createMockInteraction();
      mockDatabase.getValue.mockRejectedValue(new Error('fail'));

      await expect(reminderCommand.handleReminderStatus(mockInteraction)).rejects.toThrow('DATABASE_READ_ERROR');
    });
  });

  describe('getLatestReminderData', () => {
    it('should return null when channelId is empty', async () => {
      const res = await reminderCommand.getLatestReminderData(null, 'bump');
      expect(res).toBeNull();
    });

    it('should call getLatestReminderData and return data', async () => {
      mockReminderUtils.getLatestReminderData.mockResolvedValue({ id: 1 });
      const res = await reminderCommand.getLatestReminderData('ch-123', 'bump');
      expect(res).toEqual({ id: 1 });
      expect(mockReminderUtils.getLatestReminderData).toHaveBeenCalledWith('bump');
    });

    it('should catch error and return null on getLatestReminderData error', async () => {
      mockReminderUtils.getLatestReminderData.mockRejectedValue(new Error('fail'));
      const res = await reminderCommand.getLatestReminderData('ch-123', 'bump');
      expect(res).toBeNull();
    });
  });

  describe('calculateRemainingTime', () => {
    it('should return not scheduled if no reminderData', () => {
      expect(reminderCommand.calculateRemainingTime(null)).toBe('⚠️ Not scheduled!');
    });

    it('should return overdue if time is in past', () => {
      const res = reminderCommand.calculateRemainingTime({ remind_at: dayjs().subtract(5, 'minute').valueOf() });
      expect(res).toBe('Reminder is overdue');
    });
  });

  describe('handleError', () => {
    it('should reply with correct message for INVALID_CHANNEL_TYPE', async () => {
      const mockInteraction = createMockInteraction();
      await reminderCommand.handleError(mockInteraction, new Error('INVALID_CHANNEL_TYPE'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please select a text channel for reminders.'
      }));
    });

    it('should reply with correct message for CONFIG_INCOMPLETE', async () => {
      const mockInteraction = createMockInteraction();
      await reminderCommand.handleError(mockInteraction, new Error('CONFIG_INCOMPLETE'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Reminder configuration is incomplete. Please set up the reminder channel first.'
      }));
    });

    it('should reply with correct message for DATABASE_READ_ERROR', async () => {
      const mockInteraction = createMockInteraction();
      await reminderCommand.handleError(mockInteraction, new Error('DATABASE_READ_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve reminder settings. Please try again later.'
      })); // Cover line 277
    });

    it('should reply with correct message for DATABASE_WRITE_ERROR', async () => {
      const mockInteraction = createMockInteraction();
      await reminderCommand.handleError(mockInteraction, new Error('DATABASE_WRITE_ERROR'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to update reminder settings. Please try again later.'
      })); // Cover line 279
    });

    it('should handle unexpected errors', async () => {
      const mockInteraction = createMockInteraction();
      await reminderCommand.handleError(mockInteraction, new Error('some other error'));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while managing reminders. Please try again later.'
      }));
    });

    it('should fallback to reply if editReply throws an error inside handleError', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('Discord interaction failed'));

      await reminderCommand.handleError(mockInteraction, new Error('DATABASE_READ_ERROR'));

      // Cover lines 292-298
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for reminder command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to retrieve reminder settings. Please try again later.'
      }));
    });
  });
});
