const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

const mockCreatePaginatedResults = jest.fn();
const mockNormalizeSearchParams = jest.fn((query, resultsCount, defaultCount, minResults, maxResults) => {
  if (!query || query.trim().length === 0) {
    return { valid: false, error: "Empty query" };
  }
  return {
    valid: true,
    query: query.trim(),
    count: Math.max(minResults, Math.min(resultsCount || defaultCount, maxResults))
  };
});
const mockFormatApiError = jest.fn((apiError) => {
  const statusCode = apiError.response?.status || "unknown";
  const errorMessage = apiError.response?.data?.error?.message || apiError.message;
  return `⚠️ Google API error (${statusCode}): ${errorMessage}`;
});

jest.mock('../../utils/searchUtils', () => ({
  createPaginatedResults: mockCreatePaginatedResults,
  normalizeSearchParams: mockNormalizeSearchParams,
  formatApiError: mockFormatApiError
}));

describe('googleSearch command', () => {
  let googleSearchCommand;
  let mockConfig;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockConfig = {
      googleApiKey: 'mock-api-key',
      searchEngineId: 'mock-cse-id'
    };
    jest.doMock('../../config', () => mockConfig);

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    googleSearchCommand = require('../../commands/googleSearch');
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should reply with warning if config is incomplete (missing key or searchEngineId)', async () => {
      mockConfig.googleApiKey = null;
      const mockInteraction = createMockInteraction();

      await googleSearchCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command is not properly configured. Please contact an administrator.'
      }));
      expect(mockLogger.error).toHaveBeenCalledWith('Missing Google API configuration.', expect.any(Object));
    });

    it('should reply with error if search query is invalid (empty query)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue(''),
          getInteger: jest.fn().mockReturnValue(null)
        }
      });

      await googleSearchCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please provide a valid search query.'
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith('Invalid search parameters provided.', expect.any(Object));
    });

    it('should reply with warning if searchResult returns error', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('puppy'),
          getInteger: jest.fn().mockReturnValue(5)
        }
      });

      const apiError = new Error('API Request Failed');
      apiError.response = { status: 403, data: { error: { message: 'Quota exceeded' } } };
      mockAxios.get.mockRejectedValueOnce(apiError);

      await googleSearchCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Google API error (403): Quota exceeded'
      }));
    });

    it('should reply with warning if no results are found (empty items list)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('puppy'),
          getInteger: jest.fn().mockReturnValue(null)
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {}
      });

      await googleSearchCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No results found for your search query.'
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith('No search results found for query.', expect.any(Object));
    });

    it('should successfully search and create paginated results when results are returned', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('javascript guide'),
          getInteger: jest.fn().mockReturnValue(3)
        }
      });

      const mockItems = [
        { title: 'JS Guide', link: 'http://js.org', snippet: 'JavaScript is a language.' },
        { title: 'JS MDN', link: 'http://mdn.org', snippet: 'MDN Web Docs.' }
      ];

      mockAxios.get.mockResolvedValueOnce({
        data: { items: mockItems }
      });

      await googleSearchCommand.execute(mockInteraction);

      expect(mockAxios.get).toHaveBeenCalled();
      expect(mockCreatePaginatedResults).toHaveBeenCalled();
      
      const embedGenerator = mockCreatePaginatedResults.mock.calls[0][2];
      const embed1 = embedGenerator(0);
      expect(embed1.data.title).toBe('JS Guide');
      expect(embed1.data.description).toContain('JavaScript is a language.');
      expect(embed1.data.description).toContain('(http://js.org)');

      expect(mockLogger.info).toHaveBeenCalledWith('/google command completed successfully.', expect.any(Object));
    });

    it('should catch errors thrown during execution and forward to handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('js guide'),
          getInteger: jest.fn().mockReturnValue(3)
        }
      });

      const mockItems = [
        { title: 'JS Guide', link: 'http://js.org', snippet: 'JavaScript guide.' }
      ];

      mockAxios.get.mockResolvedValueOnce({
        data: { items: mockItems }
      });

      const execError = new Error('createPaginatedResults failed');
      mockCreatePaginatedResults.mockRejectedValueOnce(execError);

      const spyHandleError = jest.spyOn(googleSearchCommand, 'handleError').mockResolvedValueOnce();

      await googleSearchCommand.execute(mockInteraction);

      expect(spyHandleError).toHaveBeenCalledWith(mockInteraction, execError);
    });
  });

  describe('generateResultEmbed', () => {
    it('should fall back to default values if fields are missing in search results', () => {
      const mockItems = [
        { title: null, link: null, snippet: null }
      ];
      const embed = googleSearchCommand.generateResultEmbed(mockItems, 0);
      expect(embed.data.title).toBe('No Title Found');
      expect(embed.data.description).toContain('No Description Found');
      expect(embed.data.description).toContain('(No Link Found)');
    });
  });

  describe('handleError', () => {
    it('should handle API errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      await googleSearchCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in google command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to fetch search results. Please try again later.'
      }));
    });

    it('should handle network errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_NETWORK_ERROR');
      await googleSearchCommand.handleError(mockInteraction, error);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Network error occurred. Please check your internet connection.'
      }));
    });

    it('should handle rate limit errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_RATE_LIMIT');
      await googleSearchCommand.handleError(mockInteraction, error);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Rate limit exceeded. Please try again in a few minutes.'
      }));
    });

    it('should handle unexpected errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('Unexpected DB crash');
      await googleSearchCommand.handleError(mockInteraction, error);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching. Please try again later.'
      }));
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('Unexpected DB crash');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await googleSearchCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for google command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('Unexpected DB crash');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(googleSearchCommand.handleError(mockInteraction, error)).resolves.not.toThrow();
    });
  });
});
