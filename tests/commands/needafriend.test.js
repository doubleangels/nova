const { createMockInteraction } = require('../testUtils');
const dayjs = require('dayjs');

describe('needafriend command', () => {
  let needafriendCommand;
  let mockLogger;
  let mockRedditClient;
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

    mockRedditClient = {
      isRedditConfigured: jest.fn().mockReturnValue(true),
      redditApiRequest: jest.fn()
    };
    jest.doMock('../../utils/redditClient', () => mockRedditClient);

    mockReminderUtils = {
      handleReminder: jest.fn().mockResolvedValue(true),
      getNextReminderTimeAfterCleanup: jest.fn().mockResolvedValue(null),
      NEEDAFRIEND_REMINDER_MS: 86400000
    };
    jest.doMock('../../utils/reminderUtils', () => mockReminderUtils);

    needafriendCommand = require('../../commands/needafriend');
  });

  describe('execute', () => {
    it('should reply with warning if Reddit is not configured', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.isRedditConfigured.mockReturnValue(false);

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command is not properly configured. Please contact an administrator.'
      }));
    });

    it('should enforce cooldown if getNextReminderTimeAfterCleanup returns a future time (days, hours, minutes)', async () => {
      const mockInteraction = createMockInteraction();
      const futureTime = dayjs().add(2, 'day').add(5, 'hour').add(10, 'minute').add(15, 'second').toDate();
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(futureTime);

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Please wait 2 days, 5 hours, 10 minutes before using /needafriend again.')
      }));
    });

    it('should enforce cooldown with singular time strings (1 day, 1 hour, 1 minute)', async () => {
      const mockInteraction = createMockInteraction();
      const futureTime = dayjs().add(1, 'day').add(1, 'hour').add(1, 'minute').add(15, 'second').toDate();
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(futureTime);

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Please wait 1 day, 1 hour, 1 minute before using /needafriend again.')
      }));
    });

    it('should cover fallback title check when title contains key phrase but is not exact match (line 33)', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_nonsticky123',
                    permalink: '/r/needafriend/comments/nonsticky123',
                    title: 'weekly discord server advertisement thread details',
                    stickied: false
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          return {
            json: {
              data: {
                things: [
                  {
                    data: {
                      permalink: '/r/needafriend/comments/nonsticky123/comment456'
                    }
                  }
                ]
              }
            }
          };
        }
      });

      await needafriendCommand.execute(mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should cover formatRedditCommentError fallback to Unknown Reddit error (line 94)', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_sticky123',
                    permalink: '/r/needafriend/comments/sticky123',
                    title: 'Weekly Discord Server Advertisement Thread',
                    stickied: true
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          const err = new Error('');
          delete err.message;
          throw err;
        }
      });

      await needafriendCommand.execute(mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Unknown Reddit error.'
      }));
    });

    it('should reply with error if weekly thread is not found on Reddit (hot and new)', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.redditApiRequest.mockResolvedValue({
        data: { children: [] }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Could not find a post titled')
      }));
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should comment on stickied weekly advertisement thread if found', async () => {
      const mockInteraction = createMockInteraction();
      
      // Mock listing responses: hot.json and new.json
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_sticky123',
                    permalink: '/r/needafriend/comments/sticky123',
                    title: 'Weekly Discord Server Advertisement Thread',
                    stickied: true
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          return {
            json: {
              data: {
                things: [
                  {
                    data: {
                      permalink: '/r/needafriend/comments/sticky123/comment456'
                    }
                  }
                ]
              }
            }
          };
        }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Comment Posted Successfully');
      expect(mockReminderUtils.handleReminder).toHaveBeenCalledWith(
        expect.any(Object),
        86400000,
        'needafriend'
      );
    });

    it('should comment on non-stickied weekly thread if stickied is not found', async () => {
      const mockInteraction = createMockInteraction();
      
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_nonsticky123',
                    permalink: '/r/needafriend/comments/nonsticky123',
                    title: 'weekly discord server advertisement thread',
                    stickied: false
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          return {
            json: {
              data: {
                things: [
                  {
                    data: {
                      permalink: '/r/needafriend/comments/nonsticky123/comment456'
                    }
                  }
                ]
              }
            }
          };
        }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));
    });

    it('should return error if Reddit response has errors list', async () => {
      const mockInteraction = createMockInteraction();
      
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_sticky123',
                    permalink: '/r/needafriend/comments/sticky123',
                    title: 'Weekly Discord Server Advertisement Thread',
                    stickied: true
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          return {
            json: {
              errors: [
                ['RATELIMIT', 'You are doing that too much.']
              ]
            }
          };
        }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Reddit rejected the comment: RATELIMIT: You are doing that too much.'
      }));
    });

    it('should return error if comment posting returns empty or invalid parsed structure', async () => {
      const mockInteraction = createMockInteraction();
      
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_sticky123',
                    permalink: '/r/needafriend/comments/sticky123',
                    title: 'Weekly Discord Server Advertisement Thread',
                    stickied: true
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          return {
            json: {
              data: {}
            }
          };
        }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Could not parse Reddit response after commenting.'
      }));
    });

    it('should handle API exceptions and format errors with array detail', async () => {
      const mockInteraction = createMockInteraction();
      
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_sticky123',
                    permalink: '/r/needafriend/comments/sticky123',
                    title: 'Weekly Discord Server Advertisement Thread',
                    stickied: true
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          const err = new Error('Reddit error');
          err.response = {
            data: {
              json: {
                errors: [
                  ['BAD_CSS_NAME', 'Invalid stylesheet name']
                ]
              }
            }
          };
          throw err;
        }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ BAD_CSS_NAME: Invalid stylesheet name'
      }));
    });

    it('should handle API exceptions and format errors with string detail', async () => {
      const mockInteraction = createMockInteraction();
      
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_sticky123',
                    permalink: '/r/needafriend/comments/sticky123',
                    title: 'Weekly Discord Server Advertisement Thread',
                    stickied: true
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          const err = new Error('Reddit error');
          err.response = {
            data: {
              json: {
                errors: ['SIMPLE_ERROR_STRING']
              }
            }
          };
          throw err;
        }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ SIMPLE_ERROR_STRING'
      }));
    });

    it('should cover cooldown branches under 1 day (hours & minutes)', async () => {
      const mockInteraction = createMockInteraction();
      const futureTime = dayjs().add(5, 'hour').add(10, 'minute').add(15, 'second').toDate();
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(futureTime);

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Please wait 5 hours, 10 minutes before using /needafriend again.')
      }));
    });

    it('should cover cooldown branches under 1 hour (minutes only)', async () => {
      const mockInteraction = createMockInteraction();
      const futureTime = dayjs().add(10, 'minute').add(15, 'second').toDate();
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(futureTime);

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Please wait 10 minutes before using /needafriend again.')
      }));
    });

    it('should cover exact hours cooldown with no minutes (line 124 false branch)', async () => {
      const mockInteraction = createMockInteraction();
      const futureTime = dayjs().add(1, 'hour').add(15, 'second').toDate();
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(futureTime);

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please wait 1 hour before using /needafriend again.'
      }));
    });

    it('should bypass cooldown and proceed if nextNeedafriendTime is in the past (line 116 false branch)', async () => {
      const mockInteraction = createMockInteraction();
      const pastTime = dayjs().subtract(5, 'minute').toDate();
      mockReminderUtils.getNextReminderTimeAfterCleanup.mockResolvedValue(pastTime);
      mockRedditClient.redditApiRequest.mockResolvedValue({
        data: { children: [] }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
    });

    it('should handle undefined listing, missing title, and empty children array branches (lines 22, 52)', async () => {
      const mockInteraction = createMockInteraction();
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          // One undefined listing, one listing with no data, one listing with data but empty children, one post with missing title
          return path.includes('hot') ? null : {
            data: {
              children: [
                {
                  data: null
                },
                {
                  data: {
                    name: 't3_nonsticky123',
                    permalink: '/r/needafriend/comments/nonsticky123',
                    title: undefined,
                    stickied: false
                  }
                }
              ]
            }
          };
        }
      });

      await needafriendCommand.execute(mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Could not find a post titled')
      }));
    });

    it('should handle string errors in response.json.errors (line 166)', async () => {
      const mockInteraction = createMockInteraction();
      
      mockRedditClient.redditApiRequest.mockImplementation(async (method, path) => {
        if (method === 'GET') {
          return {
            data: {
              children: [
                {
                  data: {
                    name: 't3_sticky123',
                    permalink: '/r/needafriend/comments/sticky123',
                    title: 'Weekly Discord Server Advertisement Thread',
                    stickied: true
                  }
                }
              ]
            }
          };
        }
        if (method === 'POST') {
          return {
            json: {
              errors: ['STRING_ERR_1', 'STRING_ERR_2']
            }
          };
        }
      });

      await needafriendCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Reddit rejected the comment: STRING_ERR_1, STRING_ERR_2'
      }));
    });
  });
});
