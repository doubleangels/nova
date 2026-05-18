const { createMockInteraction } = require('../testUtils');
const dayjs = require('dayjs');

describe('promote command', () => {
  let promoteCommand;
  let mockLogger;
  let mockReminderUtils;
  let mockRedditClient;

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

    mockReminderUtils = {
      handleReminder: jest.fn(),
      getNextReminderTimeAfterCleanup: jest.fn()
    };
    jest.doMock('../../utils/reminderUtils', () => mockReminderUtils);

    mockRedditClient = {
      redditApiRequest: jest.fn(),
      isRedditConfigured: jest.fn()
    };
    jest.doMock('../../utils/redditClient', () => mockRedditClient);

    promoteCommand = require('../../commands/promote');
  });

  describe('validateConfiguration', () => {
    it('should call isRedditConfigured', () => {
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      const res = promoteCommand.validateConfiguration();
      expect(res).toBe(true);
      expect(mockRedditClient.isRedditConfigured).toHaveBeenCalled();
    });
  });

  describe('getLastPromotion', () => {
    it('should return next reminder time', async () => {
      const mockTime = '2025-01-01T00:00:00Z';
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(mockTime);
      const res = await promoteCommand.getLastPromotion();
      expect(res).toBe(mockTime);
    });

    it('should return null on error', async () => {
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockRejectedValue(new Error('db fail'));
      const res = await promoteCommand.getLastPromotion();
      expect(res).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handleError', () => {
    it('should editReply with generic error message', async () => {
      const mockInteraction = createMockInteraction();
      await promoteCommand.handleError(new Error('fail'), mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while promoting the post. Please try again later.'
      }));
    });

    it('should map API_ERROR correctly', async () => {
      const mockInteraction = createMockInteraction();
      await promoteCommand.handleError(new Error('API_ERROR'), mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to communicate with Reddit API.'
      }));
    });
  });

  describe('execute', () => {
    it('should return error if not configured', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(false);

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command is not properly configured. Please contact an administrator.',
        flags: 64
      }));
    });

    it('should return cooldown message if still on cooldown', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      const futureTime = dayjs().add(2, 'hour').toISOString();
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(futureTime);

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('⚠️ Please wait'),
        flags: 64
      }));
      expect(mockInteraction.reply.mock.calls[0][0].content).toContain('before promoting again.');
    });

    it('should successfully post to all subreddits and register reminder', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      // flairs mock
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ id: 'flair-1', text: 'gaming' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return {
            json: {
              data: {
                id: 'post-123',
                permalink: '/r/subreddit/comments/post-123'
              }
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockRedditClient.redditApiRequest).toHaveBeenCalledTimes(6); // 3 GET flairs + 3 POST submits
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Server Promotion Successful');
      expect(embed.data.description).toContain('Your server has been promoted on `r/discordservers_` and `r/DiscordPromote` and `r/DiscordServerPromos`.');
      expect(mockReminderUtils.handleReminder).toHaveBeenCalledWith(expect.any(Object), 86400000, 'promote');
    });

    it('should handle partial failure and display error subreddits', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      let submitCallCount = 0;
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ id: 'flair-1', text: 'gaming' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCallCount++;
          if (submitCallCount === 1) {
            // First succeeds
            return { json: { data: { id: 'post-123', permalink: '/r/sub1' } } };
          }
          // Others fail
          throw new Error('SUBREDDIT_NOEXIST');
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('_Could not post to:_ `r/DiscordPromote` (r/DiscordPromote: Subreddit does not exist or is private.); `r/DiscordServerPromos` (r/DiscordServerPromos: Subreddit does not exist or is private.)');
    });

    it('should fail with error if all subreddits fail to post', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          throw new Error('banned');
        }
        if (method === 'POST' && path === '/api/submit') {
          return {
            json: {
              errors: [['SUBREDDIT_NOTALLOWED', 'Not allowed']]
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('⚠️ Failed to post to any subreddit:'),
        flags: 64
      }));
    });
  });
});
