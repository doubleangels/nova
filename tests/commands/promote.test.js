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

    it('should map various API error types in handleError', async () => {
      const mockInteraction = createMockInteraction();
      
      await promoteCommand.handleError(new Error('API_RATE_LIMIT'), mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rate limit reached') }));

      await promoteCommand.handleError(new Error('API_NETWORK_ERROR'), mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Network error') }));

      await promoteCommand.handleError(new Error('API_ACCESS_ERROR'), mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Access denied') }));

      await promoteCommand.handleError(new Error('FLAIR_ERROR'), mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Failed to set post flair') }));

      await promoteCommand.execute(mockInteraction); // Trigger execution logic for safety

      await promoteCommand.handleError(new Error('POST_ERROR'), mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Failed to create or update post') }));

      await promoteCommand.handleError(new Error('DATABASE_ERROR'), mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Database error occurred') }));
    });

    it('should handle catch inside handleError when editReply fails', async () => {
      const mockInteraction = createMockInteraction();
      mockInteraction.editReply.mockRejectedValue(new Error('Discord offline'));
      await promoteCommand.handleError(new Error('API_ERROR'), mockInteraction);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error message.', expect.any(Object));
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

    it('should successfully post to all subreddits and register reminder (handles string-encoded data JSON and url matches)', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      let submitCount = 0;
      // flairs mock
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ id: 'flair-1', text: 'gaming' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCount++;
          if (submitCount === 1) {
            return {
              json: {
                // Cover parseSubmissionResponse string-encoded data JSON block (lines 78-81)
                data: JSON.stringify({
                  id: 'post-123',
                  permalink: '/r/subreddit/comments/post-123'
                })
              }
            };
          } else {
            return {
              json: {
                // Cover parseSubmissionResponse url fallback match (lines 73-74)
                data: {
                  id: 'post-123',
                  url: 'https://reddit.com/r/subreddit/comments/post-123'
                }
              }
            };
          }
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Server Promotion Successful');
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

    it('should handle banned or restricted subreddits (404 status)', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          const mockErr = new Error('Banned');
          mockErr.response = { status: 404, data: { reason: 'banned' } };
          throw mockErr; // Cover line 154
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('⚠️ Failed to post to any subreddit:'),
        flags: 64
      }));
    });

    it('should handle other flair fetching errors (e.g. 500 status)', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          const mockErr = new Error('Server error');
          mockErr.response = { status: 500 };
          throw mockErr; // Cover line 156
        }
        if (method === 'POST' && path === '/api/submit') {
          return {
            json: {
              data: { id: 'post-123', permalink: '/r/sub' }
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not fetch flairs'), expect.objectContaining({ status: 500 }));
    });

    it('should cover getRedditErrorMessage with thrown error response data errors', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      let submitCallCount = 0;
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCallCount++;
          const mockErr = new Error('Reddit submit failed');
          if (submitCallCount === 1) {
            mockErr.response = { data: { json: { errors: [['SUBREDDIT_NOTALLOWED', 'Not allowed']] } } };
          } else if (submitCallCount === 2) {
            mockErr.response = { data: { json: { errors: [['SUBREDDIT_NOEXIST', 'Not found']] } } };
          } else {
            mockErr.response = { data: { json: { errors: [['SOME_UNKNOWN_CODE', 'Custom detail']] } } }; // Cover line 105
          }
          throw mockErr; // Cover lines 97-105
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('⚠️ Failed to post to any subreddit:'),
        flags: 64
      }));
    });

    it('should cover getRedditErrorMessage with direct string match of errors', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      let submitCallCount = 0;
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCallCount++;
          if (submitCallCount === 1) {
            throw new Error('RATELIMIT'); // Cover line 111
          } else if (submitCallCount === 2) {
            throw new Error('SUBREDDIT_NOTALLOWED'); // Cover line 109
          } else {
            throw new Error(''); // Cover line 112
          }
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('⚠️ Failed to post to any subreddit:'),
        flags: 64
      }));
    });

    it('should cover response errors map branches and ternary check, plus SUBMIT_VALIDATION_REPOST thrown error', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      let submitCallCount = 0;
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCallCount++;
          if (submitCallCount === 1) {
            const mockErr = new Error('Validation repost');
            mockErr.response = { data: { json: { errors: [['SUBMIT_VALIDATION_REPOST', 'Already posted']] } } }; // Cover line 104
            throw mockErr;
          }
          return {
            json: {
              errors: [
                ['RATELIMIT', 'Rate limit exceeded'],
                'SOME_STRING_ERROR' // Cover non-array error item inside maps (lines 181-182)
              ]
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

    it('should handle unparseable API response', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          return {}; // Cover line 184
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Could not parse response'),
        flags: 64
      }));
    });

    it('should handle unexpected execute errors and invoke handleError', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);
      mockInteraction.deferReply.mockRejectedValue(new Error('DATABASE_ERROR')); // Cover lines 224

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Database error occurred')
      }));
    });

    it('should handle handlePost unexpected throws and log error in catch block', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);

      // Force logger.info to throw inside the try block of handlePost
      let isFirstInfo = true;
      mockLogger.info.mockImplementation((msg) => {
        if (msg === 'Attempting to post to Reddit:') {
          throw new Error('Unexpected posting explosion');
        }
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('An unexpected error occurred')
      }));
      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred while posting to Reddit.', expect.any(Object));
    });
  });
});
