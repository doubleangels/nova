const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

let mockConfig = {
  baseEmbedColor: 0x556677
};
jest.mock('../../config', () => mockConfig);

let mockDatabase = {
  getValue: jest.fn()
};
jest.mock('../../utils/database', () => mockDatabase);

let mockReminderUtils = {
  handleReminder: jest.fn(),
  NEEDAFRIEND_REMINDER_MS: 604800000
};
jest.mock('../../utils/reminderUtils', () => mockReminderUtils);

describe('fix command', () => {
  let fixCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.baseEmbedColor = 0x556677;
    fixCommand = require('../../commands/fix');
  });

  describe('execute', () => {
    it('should successfully fix Disboard reminder', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('disboard')
        }
      });

      mockDatabase.getValue.mockResolvedValue('channel-id-1');
      mockReminderUtils.handleReminder.mockResolvedValue();

      await fixCommand.execute(mockInteraction);

      expect(mockDatabase.getValue).toHaveBeenCalledWith('reminder_channel');
      expect(mockReminderUtils.handleReminder).toHaveBeenCalledWith(
        expect.objectContaining({ client: mockInteraction.client }),
        7200000,
        'bump',
        true
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Disboard Bump Reminder Fixed');
      expect(embed.data.color).toBe(0x556677);
      expect(embed.data.description).toContain('Disboard Bump');
    });

    it('should successfully fix Reddit reminder', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('reddit')
        }
      });

      mockDatabase.getValue.mockResolvedValue('channel-id-1');
      mockReminderUtils.handleReminder.mockResolvedValue();

      await fixCommand.execute(mockInteraction);

      expect(mockReminderUtils.handleReminder).toHaveBeenCalledWith(
        expect.objectContaining({ client: mockInteraction.client }),
        86400000,
        'promote',
        true
      );
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Reddit Promotion Reminder Fixed');
    });

    it('should successfully fix needafriend reminder', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('needafriend')
        }
      });

      mockDatabase.getValue.mockResolvedValue('channel-id-1');
      mockReminderUtils.handleReminder.mockResolvedValue();

      await fixCommand.execute(mockInteraction);

      expect(mockReminderUtils.handleReminder).toHaveBeenCalledWith(
        expect.objectContaining({ client: mockInteraction.client }),
        mockReminderUtils.NEEDAFRIEND_REMINDER_MS,
        'needafriend',
        true
      );
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('r/needafriend weekly Reminder Fixed');
    });

    it('should do nothing if subcommand is unknown (covers subcommand === "needafriend" false branch)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('unknown-subcommand')
        }
      });

      await fixCommand.execute(mockInteraction);

      expect(mockReminderUtils.handleReminder).not.toHaveBeenCalled();
      expect(mockInteraction.editReply).not.toHaveBeenCalled();
    });

    it('should return warning if reminder channel is not configured in database', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('disboard')
        }
      });

      mockDatabase.getValue.mockResolvedValue(null);

      await fixCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        "⚠️ Reminder configuration is incomplete. Please use `/reminder setup` to configure the reminder channel and role first."
      );
      expect(mockReminderUtils.handleReminder).not.toHaveBeenCalled();
    });

    it('should handle DATABASE_ERROR during handleFixReminder', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('disboard')
        }
      });

      mockDatabase.getValue.mockResolvedValue('channel-id');
      mockReminderUtils.handleReminder.mockRejectedValue(new Error('DATABASE_ERROR'));

      await fixCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to save reminder data to the database. Please try again later.'
      }));
    });

    it('should handle CHANNEL_NOT_FOUND during handleFixReminder', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('disboard')
        }
      });

      mockDatabase.getValue.mockResolvedValue('channel-id');
      mockReminderUtils.handleReminder.mockRejectedValue(new Error('CHANNEL_NOT_FOUND'));

      await fixCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The reminder channel could not be found.'
      }));
    });

    it('should handle generic error during handleFixReminder', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('disboard')
        }
      });

      mockDatabase.getValue.mockResolvedValue('channel-id');
      mockReminderUtils.handleReminder.mockRejectedValue(new Error('Unknown generic error'));

      await fixCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in /fix command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while fixing the disboard bump reminder. Please try again later.'
      }));
    });

    it('should fallback to interaction.reply if editReply fails inside handleFixReminder error catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('disboard')
        }
      });

      mockDatabase.getValue.mockResolvedValue('channel-id');
      mockReminderUtils.handleReminder.mockRejectedValue(new Error('DATABASE_ERROR'));
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await fixCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for fix command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to save reminder data to the database. Please try again later.'
      }));
    });

    it('should catch error if fallback reply also fails inside handleFixReminder error catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('disboard')
        }
      });

      mockDatabase.getValue.mockResolvedValue('channel-id');
      mockReminderUtils.handleReminder.mockRejectedValue(new Error('DATABASE_ERROR'));
      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValue(new Error('reply failed'));

      await expect(fixCommand.execute(mockInteraction)).resolves.not.toThrow();
    });

    it('should trigger outer execute catch and call handleError on critical failure in execute switch', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockImplementation(() => {
            throw new Error('DATABASE_ERROR');
          })
        }
      });

      await fixCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in fix command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to save reminder data to the database. Please try again later.'
      }));
    });

    it('should trigger outer execute catch with CHANNEL_NOT_FOUND', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockImplementation(() => {
            throw new Error('CHANNEL_NOT_FOUND');
          })
        }
      });

      await fixCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ The reminder channel could not be found.'
      }));
    });

    it('should trigger outer execute catch with unexpected error and handle editReply fallback to reply and catch', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockImplementation(() => {
            throw new Error('Unexpected execute failure');
          })
        }
      });

      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));

      await fixCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for fix command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while fixing the reminder. Please try again later.'
      }));
    });

    it('should catch error if fallback reply also fails inside outer execute catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockImplementation(() => {
            throw new Error('Unexpected execute failure');
          })
        }
      });

      mockInteraction.editReply.mockRejectedValue(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValue(new Error('reply failed'));

      await expect(fixCommand.execute(mockInteraction)).resolves.not.toThrow();
    });
  });
});
