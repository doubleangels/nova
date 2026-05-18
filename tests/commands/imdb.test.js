const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('imdb command', () => {
  let imdbCommand;
  let mockConfig;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockConfig = {
      omdbApiKey: 'mock-omdb-key'
    };
    jest.doMock('../../config', () => mockConfig);

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    imdbCommand = require('../../commands/imdb');
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should reply with error if config is missing (omdbApiKey is empty)', async () => {
      mockConfig.omdbApiKey = null;
      const mockInteraction = createMockInteraction();

      await imdbCommand.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command is not properly configured. Please contact an administrator.'
      }));
      expect(mockLogger.error).toHaveBeenCalledWith('OMDb API key is not configured in the application.');
    });

    it('should successfully search for a movie and display detailed information (all fields present, poster present)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('movie'),
          getString: jest.fn().mockReturnValue('Inception')
        }
      });

      const mockMovieData = {
        Title: 'Inception',
        Year: '2010',
        imdbRating: '8.8',
        Genre: 'Action, Sci-Fi',
        Director: 'Christopher Nolan',
        Actors: 'Leonardo DiCaprio, Joseph Gordon-Levitt',
        Awards: 'Won 4 Oscars',
        Plot: 'A thief who steals corporate secrets through the use of dream-sharing technology.',
        imdbID: 'tt1375666',
        Poster: 'https://images.com/inception.jpg'
      };

      mockAxios.get.mockResolvedValueOnce({
        data: mockMovieData
      });

      await imdbCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockAxios.get).toHaveBeenCalledWith('http://www.omdbapi.com/', expect.objectContaining({
        params: {
          apikey: 'mock-omdb-key',
          t: 'Inception',
          plot: 'full',
          type: 'movie'
        }
      }));

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.title).toBe('Inception');
      expect(sentEmbed.data.url).toBe('https://www.imdb.com/title/tt1375666/');
      expect(sentEmbed.data.thumbnail.url).toBe('https://images.com/inception.jpg');

      const fields = sentEmbed.data.fields;
      expect(fields.find(f => f.name === '📅 Year').value).toBe('2010');
      expect(fields.find(f => f.name === '⭐ Rating').value).toBe('8.8');
      expect(fields.find(f => f.name === '🏆 Awards').value).toBe('Won 4 Oscars');

      expect(mockLogger.info).toHaveBeenCalledWith('/imdb command completed successfully.', expect.any(Object));
    });

    it('should successfully search for a TV show with alternative fields (no imdbID, poster is N/A, missing plot and fields)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('tv'),
          getString: jest.fn().mockReturnValue('Breaking Bad')
        }
      });

      const mockTVData = {
        Title: 'Breaking Bad',
        Year: '2008–2013',
        Poster: 'N/A'
      };

      mockAxios.get.mockResolvedValueOnce({
        data: mockTVData
      });

      await imdbCommand.execute(mockInteraction);

      expect(mockAxios.get).toHaveBeenCalledWith('http://www.omdbapi.com/', expect.objectContaining({
        params: expect.objectContaining({
          type: 'series'
        } )
      }));

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.title).toBe('Breaking Bad');
      expect(sentEmbed.data.thumbnail).toBeUndefined();
      expect(sentEmbed.data.description).toBe('No plot available');

      const fields = sentEmbed.data.fields;
      expect(fields.find(f => f.name === '⭐ Rating').value).toBe('N/A');
      expect(fields.find(f => f.name === '🎭 Genre').value).toBe('N/A');
      expect(fields.find(f => f.name === '🎬 Director').value).toBe('N/A');
      expect(fields.find(f => f.name === '🔗 IMDb')).toBeUndefined();
    });

    it('should reply with error message if OMDb returns an error', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('movie'),
          getString: jest.fn().mockReturnValue('NonexistentMovieXYZ')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: { Error: 'Movie not found!' }
      });

      await imdbCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No results found for your search. Please try a different title.'
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith('No results found for query.', expect.any(Object));
    });

    it('should catch errors thrown during execution and forward to handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('movie'),
          getString: jest.fn().mockReturnValue('Inception')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('OMDb API is down'));

      await imdbCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in imdb command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching IMDb. Please try again later.'
      }));
    });

    it('should handle subcommands other than movie or tv (implicit else branch)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('other'),
          getString: jest.fn().mockReturnValue('Some Media')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        data: { Title: 'Some Media' }
      });

      await imdbCommand.execute(mockInteraction);

      expect(mockAxios.get).toHaveBeenCalledWith('http://www.omdbapi.com/', expect.objectContaining({
        params: expect.objectContaining({
          type: undefined
        })
      }));
    });
  });

  describe('handleError', () => {
    it('should handle all custom error types correctly', async () => {
      const errorCases = [
        {
          error: new Error('API_ERROR'),
          expected: '⚠️ Failed to search IMDb. Please try again later.'
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
          error: new Error('SOME_UNEXPECTED_ERROR'),
          expected: '⚠️ An unexpected error occurred while searching IMDb. Please try again later.'
        }
      ];

      for (const errCase of errorCases) {
        jest.clearAllMocks();
        const mockInteraction = createMockInteraction();

        await imdbCommand.handleError(mockInteraction, errCase.error);

        expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in imdb command.', expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: errCase.expected
        }));
      }
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await imdbCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for imdb command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to search IMDb. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(imdbCommand.handleError(mockInteraction, error)).resolves.not.toThrow();
    });
  });
});
