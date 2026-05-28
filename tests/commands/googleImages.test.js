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

describe('googleImages command', () => {
  let googleImagesCommand;
  let mockConfig;
  let mockAxios;
  let mockCommandContextAi;
  let mockGeminiContextMessages;

  beforeEach(() => {
    jest.resetModules();

    mockConfig = {
      googleApiKey: 'mock-key',
      imageSearchEngineId: 'mock-engine-id',
      googleImagesAiEnabled: false
    };
    jest.doMock('../../config', () => mockConfig);

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    mockCommandContextAi = {
      fetchGoogleImagesContext: jest.fn()
    };
    jest.doMock('../../utils/commandContextAi', () => mockCommandContextAi);

    mockGeminiContextMessages = {
      formatAiContextField: jest.fn()
    };
    jest.doMock('../../utils/geminiContextMessages', () => mockGeminiContextMessages);

    googleImagesCommand = require('../../commands/googleImages');
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should reply with error if googleApiKey or imageSearchEngineId is missing', async () => {
      mockConfig.googleApiKey = null;
      const mockInteraction = createMockInteraction();

      await googleImagesCommand.execute(mockInteraction);

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

      await googleImagesCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Please provide a valid search query.'
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith('Invalid search parameters provided.', expect.any(Object));
    });

    it('should reply with error if API returns error', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('puppy'),
          getInteger: jest.fn().mockReturnValue(5)
        }
      });

      const apiError = new Error('API Request Failed');
      apiError.response = { status: 403, data: { error: { message: 'Quota exceeded' } } };
      mockAxios.get.mockRejectedValueOnce(apiError);

      await googleImagesCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Google API error (403): Quota exceeded'
      }));
    });

    it('should reply with warning if no images are found (empty items list)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('puppy'),
          getInteger: jest.fn().mockReturnValue(null)
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {}
      });

      await googleImagesCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No images found for your search query.'
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith('No image results found for query.', expect.any(Object));
    });

    it('should successfully search and create paginated results when results are returned', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('puppy love'),
          getInteger: jest.fn().mockReturnValue(3)
        }
      });

      const mockItems = [
        { title: 'Puppy 1', link: 'http://img1.jpg', image: { contextLink: 'http://src1.html' } },
        { title: 'Puppy 2', link: 'http://img2.jpg', image: { contextLink: 'http://src2.html' } }
      ];

      mockAxios.get.mockResolvedValueOnce({
        data: { items: mockItems }
      });

      await googleImagesCommand.execute(mockInteraction);

      expect(mockAxios.get).toHaveBeenCalled();
      expect(mockCreatePaginatedResults).toHaveBeenCalled();
      
      const embedGenerator = mockCreatePaginatedResults.mock.calls[0][2];
      const embed1 = await Promise.resolve(embedGenerator(0));
      expect(embed1.data.title).toBe('Puppy 1');
      expect(embed1.data.image.url).toBe('http://img1.jpg');
      expect(embed1.data.fields?.find(f => f.name === 'Source')?.value).toContain('http://src1.html');

      expect(mockLogger.info).toHaveBeenCalledWith('/googleimages command completed successfully.', expect.any(Object));
    });

    it('should catch errors thrown during execution and forward to handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('puppy love'),
          getInteger: jest.fn().mockReturnValue(3)
        }
      });

      const mockItems = [
        { title: 'Puppy 1', link: 'http://img1.jpg', image: { contextLink: 'http://src1.html' } }
      ];

      mockAxios.get.mockResolvedValueOnce({
        data: { items: mockItems }
      });

      const execError = new Error('createPaginatedResults failed');
      mockCreatePaginatedResults.mockRejectedValueOnce(execError);

      const spyHandleError = jest.spyOn(googleImagesCommand, 'handleError').mockResolvedValueOnce();

      await googleImagesCommand.execute(mockInteraction);

      expect(spyHandleError).toHaveBeenCalledWith(mockInteraction, execError);
    });
  });

  describe('generateImageEmbed', () => {
    it('should fall back to default title if title is missing', async () => {
      const mockItems = [
        { link: null, image: { contextLink: 'http://src1.html' } }
      ];
      const { EmbedBuilder } = require('discord.js');
      const originalSetImage = EmbedBuilder.prototype.setImage;
      EmbedBuilder.prototype.setImage = jest.fn().mockReturnThis();

      try {
        const embed = await googleImagesCommand.generateImageEmbed(mockItems, 0, 'cats');
        expect(embed.data.title).toBe('No Title');
        expect(embed.data.fields?.find(f => f.name === 'Source')?.value).toContain('http://src1.html');
        expect(EmbedBuilder.prototype.setImage).not.toHaveBeenCalled();
      } finally {
        EmbedBuilder.prototype.setImage = originalSetImage;
      }
    });

    it('should fall back to imageLink if item.image is missing', async () => {
      const mockItems = [
        { title: 'No Image Obj', link: 'http://img1.jpg', image: null }
      ];
      const embed = await googleImagesCommand.generateImageEmbed(mockItems, 0); // No query provided
      const sourceField = embed.data.fields?.find(f => f.name === 'Source');
      expect(sourceField?.value).toContain('http://img1.jpg');
    });

    it('should omit source and image links if both are missing', async () => {
      const mockItems = [
        { title: 'Empty Links', link: null, image: { contextLink: null } }
      ];
      const embed = await googleImagesCommand.generateImageEmbed(mockItems, 0);
      const sourceField = embed.data.fields?.find(f => f.name === 'Source');
      const imageField = embed.data.fields?.find(f => f.name === 'Image');
      expect(sourceField).toBeUndefined();
      expect(imageField).toBeUndefined();
    });

    it('should add both Source and Image links when pageLink differs from imageLink', async () => {
      const mockItems = [
        { title: 'Diff Links', link: 'http://img.jpg', image: { contextLink: 'http://page.html' } }
      ];
      const embed = await googleImagesCommand.generateImageEmbed(mockItems, 0);
      const sourceField = embed.data.fields?.find(f => f.name === 'Source');
      const imageField = embed.data.fields?.find(f => f.name === 'Image');
      expect(sourceField?.value).toContain('http://page.html');
      expect(imageField?.value).toContain('http://img.jpg');
    });

    it('should add AI context field if googleImagesAiEnabled is true', async () => {
      mockConfig.googleImagesAiEnabled = true;
      mockCommandContextAi.fetchGoogleImagesContext.mockResolvedValue({ note: 'AI insight' });
      mockGeminiContextMessages.formatAiContextField.mockReturnValue({
        name: '🤖 AI Insight', value: 'AI insight'
      });

      const mockItems = [
        { title: 'Image 1', link: 'http://img1.jpg', image: { contextLink: 'http://src1.html' } }
      ];
      const embed = await googleImagesCommand.generateImageEmbed(mockItems, 0, 'puppy');

      expect(mockCommandContextAi.fetchGoogleImagesContext).toHaveBeenCalledWith({
        query: 'puppy',
        title: 'Image 1',
        contextLink: 'http://src1.html',
        imageLink: 'http://img1.jpg',
        resultIndex: 0
      });
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: '🤖 AI Insight', value: 'AI insight'
      }));
    });

    it('should not add AI context field if formatAiContextField returns null', async () => {
      mockConfig.googleImagesAiEnabled = true;
      mockCommandContextAi.fetchGoogleImagesContext.mockResolvedValue({ note: 'Empty' });
      mockGeminiContextMessages.formatAiContextField.mockReturnValue(null);

      const mockItems = [
        { title: 'Image 2', link: 'http://img2.jpg', image: null }
      ];
      const embed = await googleImagesCommand.generateImageEmbed(mockItems, 0, 'puppy');

      expect(embed.data.fields).not.toContainEqual(expect.objectContaining({
        name: '🤖 AI Insight'
      }));
    });

    it('should pass empty string to AI context when links are missing', async () => {
      mockConfig.googleImagesAiEnabled = true;
      mockCommandContextAi.fetchGoogleImagesContext.mockResolvedValue({});
      mockGeminiContextMessages.formatAiContextField.mockReturnValue(null);

      const mockItems = [
        { title: 'No Links', link: null, image: null }
      ];
      await googleImagesCommand.generateImageEmbed(mockItems, 0, 'cats');

      expect(mockCommandContextAi.fetchGoogleImagesContext).toHaveBeenCalledWith({
        query: 'cats',
        title: 'No Links',
        contextLink: '',
        imageLink: '',
        resultIndex: 0
      });
    });
  });

  describe('handleError', () => {
    it('should handle API errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('Google API rate limit exceeded');
      await googleImagesCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in googleimages command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to fetch search results. Please try again later.'
      }));
    });

    it('should handle network errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('network connection timed out');
      await googleImagesCommand.handleError(mockInteraction, error);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Network error occurred. Please check your internet connection.'
      }));
    });

    it('should handle rate limit errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('rate limit reached');
      await googleImagesCommand.handleError(mockInteraction, error);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Rate limit exceeded. Please try again in a few minutes.'
      }));
    });

    it('should handle unexpected errors correctly', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('Unexpected DB crash');
      await googleImagesCommand.handleError(mockInteraction, error);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching for images. Please try again later.'
      }));
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('Unexpected DB crash');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await googleImagesCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for googleimages command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching for images. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('Unexpected DB crash');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(googleImagesCommand.handleError(mockInteraction, error)).resolves.not.toThrow();
    });
  });
});
