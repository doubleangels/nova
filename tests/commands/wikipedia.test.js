const { EmbedBuilder } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('wikipedia command', () => {
  let wikipediaCommand;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    wikipediaCommand = require('../../commands/wikipedia');
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should successfully search for an article, fetch summary, and display it (short summary)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('JavaScript')
        }
      });

      const mockSummaryResponse = {
        data: {
          title: 'JavaScript',
          extract: 'JavaScript is a programming language.',
          content_urls: {
            desktop: {
              page: 'https://en.wikipedia.org/wiki/JavaScript'
            }
          }
        }
      };

      mockAxios.get.mockResolvedValueOnce(mockSummaryResponse);

      await wikipediaCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://en.wikipedia.org/api/rest_v1/page/summary/JavaScript',
        expect.objectContaining({
          timeout: 10000
        })
      );

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.title).toBe('JavaScript');
      expect(sentEmbed.data.description).toBe('JavaScript is a programming language.');
      expect(sentEmbed.data.url).toBe('https://en.wikipedia.org/wiki/JavaScript');

      expect(mockLogger.info).toHaveBeenCalledWith('/wikipedia command completed successfully.', expect.any(Object));
    });

    it('should return cached embed without calling the API', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('CachedPage')
        }
      });

      const cachedEmbed = new EmbedBuilder()
        .setTitle('Cached Page')
        .setDescription('Cached summary');

      const { setCached, cacheKey } = require('../../utils/responseCache');
      setCached(cacheKey('wikipedia', 'cachedpage'), cachedEmbed, 900000);

      await wikipediaCommand.execute(mockInteraction);

      expect(mockAxios.get).not.toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith({ embeds: [cachedEmbed] });
    });

    it('should truncate summary if it exceeds 1024 characters', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('LongArticle')
        }
      });

      const longSummary = 'a'.repeat(1100);

      mockAxios.get.mockResolvedValueOnce({
        data: {
          extract: longSummary,
          title: 'LongArticle',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/LongArticle' } }
        }
      });

      await wikipediaCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.description).toHaveLength(1024);
      expect(sentEmbed.data.description.endsWith('...')).toBe(true);
    });

    it('should reply with error if search query returns no results', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('nonexistentqueryxyz')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {}
      });

      await wikipediaCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No results found for your search query.'
      }));
    });

    it('should fall back to query title and default URL when page metadata is minimal', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('FallbackQuery')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          extract: 'Short article text.'
        }
      });

      await wikipediaCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.title).toBe('FallbackQuery');
      expect(sentEmbed.data.url).toBe('https://en.wikipedia.org/wiki/FallbackQuery');
    });

    it('should catch errors thrown during execution and forward to handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('JavaScript')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('Wikipedia API is down'));

      await wikipediaCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in wikipedia command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching Wikipedia. Please try again later.'
      }));
    });
  });

  describe('handleError', () => {
    it('should handle all custom error types correctly', async () => {
      const errorCases = [
        {
          error: new Error('API_ERROR'),
          expected: '⚠️ Failed to search Wikipedia. Please try again later.'
        },
        {
          error: new Error('API_RATE_LIMIT'),
          expected: '⚠️ Rate limit exceeded. Please try again in a few minutes.'
        },
        {
          error: new Error('API_NETWORK_ERROR'),
          expected: '⚠️ Network error occurred. Please check your internet connection.'
        },
        {
          error: new Error('NO_RESULTS'),
          expected: '⚠️ No results found for your search query.'
        },
        {
          error: new Error('INVALID_QUERY'),
          expected: '⚠️ Please provide a valid search query.'
        },
        {
          error: { code: 'ECONNABORTED', message: 'timeout' },
          expected: '⚠️ Request timed out. Please try again later.'
        },
        {
          error: { response: { status: 403 }, message: 'forbidden' },
          expected: '⚠️ Access to Wikipedia API denied. Please try again later.'
        },
        {
          error: { response: { status: 429 }, message: 'rate limit' },
          expected: '⚠️ Too many requests. Please try again in a few minutes.'
        },
        {
          error: { response: { status: 502 }, message: 'bad gateway' },
          expected: '⚠️ Wikipedia API is currently unavailable. Please try again later.'
        },
        {
          error: new Error('SOME_UNEXPECTED_ERROR'),
          expected: '⚠️ An unexpected error occurred while searching Wikipedia. Please try again later.'
        }
      ];

      for (const errCase of errorCases) {
        jest.clearAllMocks();
        const mockInteraction = createMockInteraction();

        await wikipediaCommand.handleError(mockInteraction, errCase.error);

        expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in wikipedia command.', expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: errCase.expected
        }));
      }
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await wikipediaCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for wikipedia command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to search Wikipedia. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(wikipediaCommand.handleError(mockInteraction, error)).resolves.not.toThrow();
    });
  });
});
