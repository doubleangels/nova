const { EmbedBuilder } = require('discord.js');
const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('urban command', () => {
  let urbanCommand;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    urbanCommand = require('../../commands/urban');
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should successfully search for a term and display definition (all fields present)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('hello')
        }
      });

      const mockDefinition = {
        word: 'hello',
        definition: 'A common greeting.',
        example: 'Hello, how are you?',
        author: 'Greeter',
        thumbs_up: 120,
        thumbs_down: 5
      };

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: [mockDefinition]
        }
      });

      await urbanCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockAxios.get).toHaveBeenCalledWith('https://api.urbandictionary.com/v0/define?term=hello');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.title).toBe('Urban Dictionary: hello');
      expect(sentEmbed.data.description).toBe('A common greeting.');

      const fields = sentEmbed.data.fields;
      expect(fields.find(f => f.name === 'Example').value).toBe('Hello, how are you?');
      expect(fields.find(f => f.name === 'Author').value).toBe('Greeter');
      expect(fields.find(f => f.name === '👍').value).toBe('120');
      expect(fields.find(f => f.name === '👎').value).toBe('5');

      expect(mockLogger.info).toHaveBeenCalledWith('/urban command completed successfully.', expect.any(Object));
    });

    it('should fall back to default values for example and author if missing in definition', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('mockterm')
        }
      });

      const mockDefinition = {
        word: 'mockterm',
        definition: 'A term without example or author.',
        thumbs_up: 0,
        thumbs_down: 0
      };

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: [mockDefinition]
        }
      });

      await urbanCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const fields = sentEmbed.data.fields;
      expect(fields.find(f => f.name === 'Example').value).toBe('No example provided.');
      expect(fields.find(f => f.name === 'Author').value).toBe('Unknown');
    });

    it('should return cached embed without calling the API', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('CachedTerm')
        }
      });

      const cachedEmbed = new EmbedBuilder()
        .setTitle('Urban Dictionary: cached')
        .setDescription('from cache');

      const { setCached, cacheKey } = require('../../utils/responseCache');
      setCached(cacheKey('urban', 'cachedterm'), cachedEmbed, 900000);

      await urbanCommand.execute(mockInteraction);

      expect(mockAxios.get).not.toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith({ embeds: [cachedEmbed] });
    });

    it('should treat missing thumb counts as zero in score comparison', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('term')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: [
            {
              word: 'term',
              definition: 'No thumbs',
              example: 'ex',
              author: 'a'
            },
            {
              word: 'term',
              definition: 'With thumbs',
              example: 'ex2',
              author: 'b',
              thumbs_up: 5,
              thumbs_down: 0
            }
          ]
        }
      });

      await urbanCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.description).toBe('With thumbs');
    });

    it('should keep the current best when scores are equal', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('term')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: [
            {
              word: 'term',
              definition: 'First equal',
              example: 'ex1',
              author: 'a1',
              thumbs_up: 5,
              thumbs_down: 2
            },
            {
              word: 'term',
              definition: 'Second equal',
              example: 'ex2',
              author: 'a2',
              thumbs_up: 6,
              thumbs_down: 3
            }
          ]
        }
      });

      await urbanCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.description).toBe('First equal');
    });

    it('should keep the current best when scores are tied', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('term')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: [
            {
              word: 'term',
              definition: 'First tied',
              example: 'ex1',
              author: 'a1',
              thumbs_up: 5,
              thumbs_down: 2
            },
            {
              word: 'term',
              definition: 'Second tied',
              example: 'ex2',
              author: 'a2',
              thumbs_up: 6,
              thumbs_down: 3
            }
          ]
        }
      });

      await urbanCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.description).toBe('First tied');
    });

    it('should keep best when later definition has zero thumbs_up', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('term')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: [
            {
              word: 'term',
              definition: 'Zero thumbs leader',
              example: 'ex1',
              author: 'a1',
              thumbs_up: 0,
              thumbs_down: 0
            },
            {
              word: 'term',
              definition: 'Negative score',
              example: 'ex2',
              author: 'a2',
              thumbs_up: 0,
              thumbs_down: 5
            }
          ]
        }
      });

      await urbanCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.description).toBe('Zero thumbs leader');
    });

    it('should keep the first definition when later entries have lower scores', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('term')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: [
            {
              word: 'term',
              definition: 'Best first',
              example: 'ex1',
              author: 'a1',
              thumbs_up: 100,
              thumbs_down: 0
            },
            {
              word: 'term',
              definition: 'Worse second',
              example: 'ex2',
              author: 'a2',
              thumbs_up: 1,
              thumbs_down: 50
            }
          ]
        }
      });

      await urbanCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.description).toBe('Best first');
    });

    it('should pick the definition with the best thumb score when multiple exist', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('term')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: [
            {
              word: 'term',
              definition: 'Low score definition',
              example: 'ex1',
              author: 'a1',
              thumbs_up: 2,
              thumbs_down: 10
            },
            {
              word: 'term',
              definition: 'High score definition',
              example: 'ex2',
              author: 'a2',
              thumbs_up: 50,
              thumbs_down: 1
            }
          ]
        }
      });

      await urbanCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.description).toBe('High score definition');
    });

    it('should reply with error if no definitions are found', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('nonexistenttermxyz')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: []
        }
      });

      await urbanCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No definitions found for that term.'
      }));
    });

    it('should reply with error when definitions list is null', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('nullterm')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: {
          list: null
        }
      });

      await urbanCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No definitions found for that term.'
      }));
    });

    it('should catch errors thrown during execution and forward to handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('hello')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('Urban API is down'));

      await urbanCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in urban command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching Urban Dictionary. Please try again later.'
      }));
    });
  });

  describe('handleError', () => {
    it('should handle all custom error types correctly', async () => {
      const errorCases = [
        {
          error: new Error('API_ERROR'),
          expected: '⚠️ Failed to search Urban Dictionary. Please try again later.'
        },
        {
          error: new Error('RATE_LIMIT'),
          expected: '⚠️ Rate limit exceeded. Please try again in a few minutes.'
        },
        {
          error: new Error('NETWORK_ERROR'),
          expected: '⚠️ Network error occurred. Please check your internet connection.'
        },
        {
          error: new Error('NO_RESULTS'),
          expected: '⚠️ No definitions found for your search term.'
        },
        {
          error: new Error('INVALID_TERM'),
          expected: '⚠️ Please provide a valid search term.'
        },
        {
          error: new Error('SOME_UNEXPECTED_ERROR'),
          expected: '⚠️ An unexpected error occurred while searching Urban Dictionary. Please try again later.'
        }
      ];

      for (const errCase of errorCases) {
        jest.clearAllMocks();
        const mockInteraction = createMockInteraction();

        await urbanCommand.handleError(mockInteraction, errCase.error);

        expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in urban command.', expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: errCase.expected
        }));
      }
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await urbanCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for urban command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to search Urban Dictionary. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(urbanCommand.handleError(mockInteraction, error)).resolves.not.toThrow();
    });
  });
});
