const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('dog command', () => {
  let dogCommand;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    dogCommand = require('../../commands/dog');
    jest.clearAllMocks();
  });

  describe('autocomplete', () => {
    it('should provide suggestions when query matches breed name or value', async () => {
      const mockInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue('husky')
        },
        respond: jest.fn().mockResolvedValue(true)
      };

      await dogCommand.autocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalled();
      const suggestions = mockInteraction.respond.mock.calls[0][0];
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].name.toLowerCase()).toContain('husky');
    });

    it('should return default suggestions (up to 25) if query is empty', async () => {
      const mockInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue('')
        },
        respond: jest.fn().mockResolvedValue(true)
      };

      await dogCommand.autocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalled();
      const suggestions = mockInteraction.respond.mock.calls[0][0];
      expect(suggestions.length).toBe(25);
    });

    it('should fall back to empty array and catch errors silently if autocomplete respond fails', async () => {
      const mockInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue('husky')
        },
        respond: jest.fn().mockRejectedValueOnce(new Error('Discord offline'))
      };

      await expect(dogCommand.autocomplete(mockInteraction)).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in dog breed autocomplete.', expect.any(Object));
    });

    it('should silently ignore error if secondary respond also fails', async () => {
      const mockInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue('husky')
        },
        respond: jest.fn().mockRejectedValue(new Error('Discord totally offline'))
      };

      await expect(dogCommand.autocomplete(mockInteraction)).resolves.not.toThrow();
    });
  });

  describe('execute', () => {
    it('should successfully fetch and display a random dog image when no breed is provided', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue(null)
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: { message: 'https://images.dog.ceo/breeds/husky/n02110185_1469.jpg', status: 'success' }
      });

      await dogCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockAxios.get).toHaveBeenCalledWith('https://dog.ceo/api/breeds/image/random');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.title).toBe('Random Dog');
      expect(sentEmbed.data.image.url).toBe('https://images.dog.ceo/breeds/husky/n02110185_1469.jpg');

      expect(mockLogger.info).toHaveBeenCalledWith('/dog command completed successfully.', expect.any(Object));
    });

    it('should successfully fetch and display a specific breed dog image with correct path formatting', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('bulldog-french')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: { message: 'https://images.dog.ceo/breeds/bulldog-french/n02108962_34.jpg', status: 'success' }
      });

      await dogCommand.execute(mockInteraction);

      expect(mockAxios.get).toHaveBeenCalledWith('https://dog.ceo/api/breed/bulldog/french/images/random');
      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.image.url).toBe('https://images.dog.ceo/breeds/bulldog-french/n02108962_34.jpg');
    });

    it('should throw NO_IMAGE_URL error if api returns empty or falsy message', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue(null)
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: { status: 'success' }
      });

      await dogCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in dog command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Couldn\'t find a dog picture. Try again later.'
      }));
    });

    it('should handle all custom error types in handleError', async () => {
      const errorCases = [
        {
          error: new Error('API_ERROR'),
          expected: '⚠️ Couldn\'t fetch a dog picture due to an API error. Try again later.'
        },
        {
          error: new Error('NO_IMAGE_URL'),
          expected: '⚠️ Couldn\'t find a dog picture. Try again later.'
        },
        {
          error: new Error('IMAGE_FETCH_ERROR'),
          expected: '⚠️ Couldn\'t download the dog picture. Try again later.'
        },
        {
          error: new Error('NETWORK_ERROR'),
          expected: '⚠️ Network error: Could not connect to the service. Please check your internet connection.'
        },
        {
          error: new Error('UNEXPECTED_DATABASE_DOWN'),
          expected: '⚠️ An unexpected error occurred while fetching the dog image. Please try again later.'
        }
      ];

      for (const errCase of errorCases) {
        jest.clearAllMocks();
        const mockInteraction = createMockInteraction({
          options: {
            getString: jest.fn().mockReturnValue(null)
          }
        });

        mockAxios.get.mockRejectedValueOnce(errCase.error);

        await dogCommand.execute(mockInteraction);

        expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in dog command.', expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: errCase.expected
        }));
      }
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue(null)
        }
      });

      const error = new Error('NETWORK_ERROR');
      mockAxios.get.mockRejectedValueOnce(error);
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await dogCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for dog command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Network error: Could not connect to the service. Please check your internet connection.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue(null)
        }
      });

      const error = new Error('NETWORK_ERROR');
      mockAxios.get.mockRejectedValueOnce(error);
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(dogCommand.execute(mockInteraction)).resolves.not.toThrow();
    });
  });
});
