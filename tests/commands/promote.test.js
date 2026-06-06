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
      tryAcquireCommandCooldown: jest.fn().mockResolvedValue({
        acquired: true,
        reminderId: 'test-reminder',
        remind_at: dayjs().add(1, 'day').toISOString(),
        delayMs: 86400000,
        type: 'promote'
      }),
      releaseCommandCooldown: jest.fn().mockResolvedValue(undefined),
      scheduleCommandCooldownNotifications: jest.fn().mockResolvedValue(undefined),
      getNextReminderTimeAfterCleanup: jest.fn(),
      isReminderConfigured: jest.fn().mockResolvedValue(true),
      replyReminderNotConfigured: jest.fn().mockResolvedValue(undefined),
      PROMOTE_REMINDER_MS: 86400000
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
      expect(mockLogger.debug).toHaveBeenCalledWith('Found next promotion time.', expect.any(Object));
    });

    it('should return null when no promotion time is scheduled', async () => {
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(null);
      const res = await promoteCommand.getLastPromotion();
      expect(res).toBeNull();
      expect(mockLogger.debug).not.toHaveBeenCalled();
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

    it('should show incomplete configuration embed when reminders are not configured', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.isReminderConfigured.mockResolvedValue(false);

      await promoteCommand.execute(mockInteraction);

      expect(mockReminderUtils.replyReminderNotConfigured).toHaveBeenCalledWith(mockInteraction);
      expect(mockReminderUtils.tryAcquireCommandCooldown).not.toHaveBeenCalled();
    });

    it('should show incomplete configuration embed when cooldown acquire reports not configured', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);
      mockReminderUtils.isReminderConfigured.mockResolvedValue(true);
      mockReminderUtils.tryAcquireCommandCooldown.mockResolvedValue({ acquired: false, notConfigured: true });

      await promoteCommand.execute(mockInteraction);

      expect(mockReminderUtils.replyReminderNotConfigured).toHaveBeenCalledWith(mockInteraction);
    });

    it('should return cooldown message if still on cooldown', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      const futureTime = dayjs().add(2, 'hour').toISOString();
      mockReminderUtils.tryAcquireCommandCooldown.mockResolvedValue({ acquired: false, nextTime: futureTime });

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
      expect(mockReminderUtils.scheduleCommandCooldownNotifications).toHaveBeenCalledWith(
        mockInteraction.client,
        'promote',
        expect.objectContaining({ acquired: true })
      );
      expect(mockReminderUtils.releaseCommandCooldown).not.toHaveBeenCalled();
    });

    it('should handle partial failure and display error subreddits', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

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
      expect(mockReminderUtils.releaseCommandCooldown).toHaveBeenCalledWith('promote');
      expect(mockReminderUtils.scheduleCommandCooldownNotifications).not.toHaveBeenCalled();
    });

    it('should handle banned or restricted subreddits (404 status)', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

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
      mockInteraction.deferReply.mockRejectedValue(new Error('DATABASE_ERROR')); // Cover lines 224

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Database error occurred')
      }));
    });

    it('should handle json errors array in submit response without throwing', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { errors: [['RATELIMIT', 'slow down']] } };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Rate limit exceeded'),
        flags: 64
      }));
    });

    it('should parse post id from data.name when data.id is missing', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ flair_template_id: 'flair-1', text: 'gaming' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return {
            json: {
              data: {
                name: 't3_post-from-name',
                permalink: '/r/discordservers_/comments/abc'
              }
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should ignore invalid JSON in string-encoded data field', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: 'not-json' } };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Could not parse response'),
        flags: 64
      }));
    });

    it('should match preferred flair text when available', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [
            { id: 'flair-other', text: 'other' },
            { id: 'flair-gaming', text: 'Gaming Server' }
          ];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 'post-1', permalink: '/r/discordservers_/comments/1' } } };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using flair for r/discordservers_'),
        expect.objectContaining({ matchedPreferred: true })
      );
    });

    it('should handle RATELIMIT and malformed API error arrays in response', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      let submitCallCount = 0;
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCallCount++;
          if (submitCallCount === 1) {
            const mockErr = new Error('Rate limited');
            mockErr.response = { data: { json: { errors: [['RATELIMIT', 'You are doing that too much']] } } };
            throw mockErr;
          }
          const mockErr = new Error('Bad format');
          mockErr.response = { data: { json: { errors: ['not-an-array'] } } };
          throw mockErr;
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringMatching(/Rate limit|RATELIMIT|Unknown error/)
      }));
    });

    it('should parse submission with json errors, relative url, and string-encoded name/url', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      let submitCount = 0;
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ flair_template_id: 'ft-1', flair_text: 'unrelated' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCount++;
          if (submitCount === 1) {
            return { json: { errors: [['ERR', 'fail']] } };
          }
          if (submitCount === 2) {
            return { json: { data: { name: 't3_abc', url: 'not-a-full-url' } } };
          }
          return {
            json: {
              data: JSON.stringify({
                name: 't3_strpost',
                url: 'relative/path'
              })
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should use first flair when preferred text does not match', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [
            { flair_identifier: 'fi-1', flair_text: 'other category' },
            { id: 'flair-2', text: 'another' }
          ];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 'post-1', permalink: '/r/DiscordPromote/comments/1' } } };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using flair for r/DiscordPromote'),
        expect.objectContaining({ matchedPreferred: false })
      );
    });

    it('should parse string-encoded submission with id and non-matching url', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          return {
            json: {
              data: JSON.stringify({
                id: 'str-id',
                url: 'not-http-url'
              })
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should parse string-encoded submission using name and url fallbacks', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      let submitCount = 0;
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCount++;
          if (submitCount <= 2) {
            return {
              json: {
                data: JSON.stringify({
                  name: 't3_nameonly',
                  url: 'https://reddit.com/r/test/comments/abc'
                })
              }
            };
          }
          return {
            json: {
              data: JSON.stringify({
                name: 't3_other',
                url: 'no-scheme-path'
              })
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should handle submission response with null data object', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: null } };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Could not parse response')
      }));
    });

    it('should proceed when cooldown has expired', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 'post-1', permalink: '/r/discordservers_/comments/1' } } };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
    });

    it('should parse string-encoded submission using name and https url path segment', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          return {
            json: {
              data: JSON.stringify({
                name: 't3_urlonly',
                url: 'https://reddit.com/r/discordservers_/comments/xyz'
              })
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should parse string-encoded submission using name and non-http url fallbacks', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      let submitCount = 0;
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          submitCount++;
          if (submitCount === 1) {
            return {
              json: {
                data: JSON.stringify({
                  name: 't3_nameonly',
                  url: 'not-http-url'
                })
              }
            };
          }
          return {
            json: {
              data: JSON.stringify({
                name: 't3_other',
                url: 'https://reddit.com/r/test/comments/abc'
              })
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should fall through getRedditErrorMessage when API error tuple is too short', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          const mockErr = new Error('');
          mockErr.response = { data: { json: { errors: [['ONLY_CODE']] } } };
          throw mockErr;
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Unknown error')
      }));
    });

    it('should select flair via flair_text when text is missing', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ flair_template_id: 'ft-1', flair_text: 'gaming server' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 'post-1', permalink: '/r/DiscordPromote/comments/1' } } };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using flair for r/DiscordPromote'),
        expect.objectContaining({ matchedPreferred: true })
      );
    });

    it('should parse string-encoded submission with id and permalink only', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [];
        }
        if (method === 'POST' && path === '/api/submit') {
          return {
            json: {
              data: JSON.stringify({
                id: 'direct-id',
                permalink: '/r/discordservers_/comments/direct-id'
              })
            }
          };
        }
        return null;
      });

      await promoteCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should handle handlePost unexpected throws and log error in catch block', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(true);

      // Force logger.info to throw inside the try block of handlePost
      let isFirstInfo = true;
      mockLogger.info.mockImplementation((msg) => {
        if (msg === 'Attempting to post to Reddit.') {
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

  describe('internal helpers', () => {
    it('should parseSubmissionResponse uses object data without string-encoded branch', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: { id: 'obj-only', permalink: '/r/x/comments/obj-only' }
        }
      });
      expect(result.postId).toBe('obj-only');
    });

    it('should parseSubmissionResponse handles string-encoded JSON', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: JSON.stringify({ name: 't3_abc', permalink: '/r/x/comments/abc' })
        }
      });
      expect(result.postId).toBe('abc');
    });

    it('should parseSubmissionResponse uses name when id is missing in object data', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: { name: 't3_objname', url: 'https://reddit.com/r/x/comments/objname' }
        }
      });
      expect(result.postId).toBe('objname');
    });

    it('should parseSubmissionResponse uses name when id is missing in string JSON', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: JSON.stringify({ name: 't3_onlyname', url: 'https://reddit.com/r/x/comments/onlyname' })
        }
      });
      expect(result.postId).toBe('onlyname');
      expect(result.permalink).toBe('/r/x/comments/onlyname');
    });

    it('should parseSubmissionResponse uses name only in string JSON without url', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: JSON.stringify({ name: 't3_nameonly' })
        }
      });
      expect(result).toBeNull();
    });

    it('should parseSubmissionResponse reads id from string JSON payload', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: JSON.stringify({ id: 'str-id', permalink: '/r/x/comments/str-id' })
        }
      });
      expect(result.postId).toBe('str-id');
    });

    it('should parseSubmissionResponse uses id from string JSON without name field', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: JSON.stringify({ id: 'only-id', permalink: '/r/x/comments/only-id' })
        }
      });
      expect(result.postId).toBe('only-id');
    });

    it('should parseSubmissionResponse uses permalink from string JSON without url', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: JSON.stringify({ id: 'str-perm', permalink: '/r/x/comments/str-perm' })
        }
      });
      expect(result).toEqual({ postId: 'str-perm', permalink: '/r/x/comments/str-perm' });
    });

    it('should postToSubreddit falls back when flair entries lack text fields', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [
            { id: 'no-text-1' },
            { id: 'flair-2', text: 'gaming' }
          ];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 't3_x', permalink: '/r/x' } } };
        }
        return null;
      });
      const result = await promoteCommand.__test__.postToSubreddit('discordservers_', 'title');
      expect(result.success).toBe(true);
    });

    it('should postToSubreddit matches flair using flair_text when text is missing', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ flair_template_id: 'ft-gaming', flair_text: 'gaming community' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 't3_g', permalink: '/r/g' } } };
        }
        return null;
      });
      const result = await promoteCommand.__test__.postToSubreddit('discordservers_', 'title');
      expect(result.success).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using flair for r/discordservers_'),
        expect.objectContaining({ matchedPreferred: true })
      );
    });

    it('should postToSubreddit skips preferred flair lookup when subreddit has no preference', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ id: 'flair-1', text: 'general' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 't3_x', permalink: '/r/x' } } };
        }
        return null;
      });
      const result = await promoteCommand.__test__.postToSubreddit('NoPreferenceSub', 'title');
      expect(result.success).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using flair for r/NoPreferenceSub'),
        expect.objectContaining({ matchedPreferred: false })
      );
    });

    it('should postToSubreddit matches preferred flair by flair_text when text is absent', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ flair_template_id: 'ft-2', flair_text: 'gaming server promo' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 't3_match', permalink: '/r/m' } } };
        }
        return null;
      });
      const result = await promoteCommand.__test__.postToSubreddit('DiscordPromote', 'title');
      expect(result.success).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using flair for r/DiscordPromote'),
        expect.objectContaining({ matchedPreferred: true })
      );
    });

    it('should postToSubreddit falls back to first flair when preferred text is not found', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ id: 'flair-x', text: 'unrelated' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 't3_fb', permalink: '/r/fb' } } };
        }
        return null;
      });
      const result = await promoteCommand.__test__.postToSubreddit('DiscordServerPromos', 'title');
      expect(result.success).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using flair for r/DiscordServerPromos'),
        expect.objectContaining({ matchedPreferred: false })
      );
    });

    it('should postToSubreddit falls back to first flair when preference does not match', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ id: 'flair-1', text: 'unrelated flair' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 't3_z', permalink: '/r/z' } } };
        }
        return null;
      });
      const result = await promoteCommand.__test__.postToSubreddit('discordservers_', 'title');
      expect(result.success).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Using flair for r/discordservers_'),
        expect.objectContaining({ matchedPreferred: false })
      );
    });

    it('should postToSubreddit uses first flair when subreddit has no preference entry', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET' && path.includes('/api/link_flair')) {
          return [{ flair_template_id: 'ft-unknown', text: 'misc' }];
        }
        if (method === 'POST' && path === '/api/submit') {
          return { json: { data: { id: 't3_u', permalink: '/r/u' } } };
        }
        return null;
      });
      const result = await promoteCommand.__test__.postToSubreddit('unknownsubreddit', 'title');
      expect(result.success).toBe(true);
    });

    it('should parseSubmissionResponse ignores invalid string-encoded JSON', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: { data: 'not-json' }
      });
      expect(result).toBeNull();
    });

    it('should parseSubmissionResponse returns null when string JSON has no id, name, or permalink', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: { data: JSON.stringify({ url: 'https://reddit.com' }) }
      });
      expect(result).toBeNull();
    });

    it('should parseSubmissionResponse uses full url when string JSON url has no path match', () => {
      const result = promoteCommand.__test__.parseSubmissionResponse({
        json: {
          data: JSON.stringify({
            id: 'url-id',
            url: 'not-a-valid-url'
          })
        }
      });
      expect(result).toEqual({ postId: 'url-id', permalink: 'not-a-valid-url' });
    });

    it('should getRedditErrorMessage uses Reddit label when subreddit is falsy', () => {
      const msg = promoteCommand.__test__.getRedditErrorMessage(new Error('fail'), '');
      expect(msg).toContain('Reddit');
    });

    it('should postToSubreddit uses default empty body and truncates long text', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path, data) => {
        if (method === 'GET' && path.includes('/api/link_flair')) return [];
        if (method === 'POST' && path === '/api/submit') {
          expect(data.text).toHaveLength(10000);
          return { json: { data: { id: 't3_x', permalink: '/r/x' } } };
        }
        return null;
      });
      const longBody = 'x'.repeat(10001);
      const result = await promoteCommand.__test__.postToSubreddit('testsub', 'title', longBody);
      expect(result.success).toBe(true);
    });

    it('should not export __test__ helpers outside test environment', () => {
      jest.isolateModules(() => {
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const cmd = require('../../commands/promote');
        expect(cmd.__test__).toBeUndefined();
        process.env.NODE_ENV = previousEnv;
      });
    });

    it('should postToSubreddit omits text when body is empty', async () => {
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path, data) => {
        if (method === 'GET' && path.includes('/api/link_flair')) return [];
        if (method === 'POST' && path === '/api/submit') {
          expect(data.text).toBeUndefined();
          return { json: { data: { id: 't3_y', permalink: '/r/y' } } };
        }
        return null;
      });
      const result = await promoteCommand.__test__.postToSubreddit('testsub', 'title');
      expect(result.success).toBe(true);
    });
  });
});
