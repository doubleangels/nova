const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('anime command', () => {
  let animeCommand;
  let mockConfig;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockConfig = {
      malClientId: 'mal-client-id-xyz'
    };
    jest.doMock('../../config', () => mockConfig);

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    animeCommand = require('../../commands/anime');
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should reply with error if malClientId is not configured', async () => {
      mockConfig.malClientId = null;
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Naruto')
        }
      });

      await animeCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('MyAnimeList API client ID is not configured.');
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command is not properly configured. Please contact an administrator.'
      }));
    });

    it('should successfully search and display anime details with all optional fields', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Naruto')
        }
      });

      const mockSearchResponse = {
        status: 200,
        data: {
          data: [
            {
              node: {
                id: 20,
                title: 'Naruto',
                synopsis: 'A story about a ninja.',
                mean: 7.9,
                genres: [{ name: 'Action' }, { name: 'Adventure' }],
                start_date: '2002-10-03',
                main_picture: {
                  medium: 'https://cdn.myanimelist.net/images/anime/13/75127.jpg'
                }
              }
            }
          ]
        }
      };

      mockAxios.get.mockResolvedValueOnce(mockSearchResponse);

      await animeCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Naruto');
      expect(embed.data.description).toBe('**Synopsis:** A story about a ninja.');
      expect(embed.data.thumbnail.url).toBe('https://cdn.myanimelist.net/images/anime/13/75127.jpg');
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: '🎭 Genre',
        value: 'Action, Adventure'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: '⭐ MAL Rating',
        value: '7.9'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: '📅 Release Date',
        value: 'October 3, 2002'
      }));
    });

    it('should successfully handle missing optional details and release dates formats', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Bleach')
        }
      });

      const mockSearchResponse = {
        status: 200,
        data: {
          data: [
            {
              node: {
                id: 269,
                title: null,
                synopsis: null,
                mean: null,
                genres: null,
                start_date: null
              }
            }
          ]
        }
      };

      mockAxios.get.mockResolvedValueOnce(mockSearchResponse);

      await animeCommand.execute(mockInteraction);

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('Unknown');
      expect(embed.data.description).toBe('**Synopsis:** No synopsis available.');
      expect(embed.data.thumbnail).toBeUndefined();
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: '🎭 Genre',
        value: 'Unknown'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: '⭐ MAL Rating',
        value: 'N/A'
      }));
      expect(embed.data.fields).toContainEqual(expect.objectContaining({
        name: '📅 Release Date',
        value: 'Unknown'
      }));
    });

    it('should correctly format different release date lengths and patterns', () => {
      // 4 chars (Year only)
      expect(animeCommand.formatReleaseDate('2004')).toBe('2004');
      // 7 chars (Year-Month) - valid
      expect(animeCommand.formatReleaseDate('2004-10')).toBe('October 2004');
      // 7 chars - invalid date (e.g. non-numeric months that fail dayjs parsing)
      expect(animeCommand.formatReleaseDate('2004-ab')).toBe('2004-ab');
      // 10 chars (Full date) - valid
      expect(animeCommand.formatReleaseDate('2004-10-12')).toBe('October 12, 2004');
      // 10 chars - invalid date
      expect(animeCommand.formatReleaseDate('2004-ab-cd')).toBe('2004-ab-cd');
      // Unknown or null
      expect(animeCommand.formatReleaseDate(null)).toBe('Unknown');
      expect(animeCommand.formatReleaseDate('Unknown')).toBe('Unknown');
      // Other lengths
      expect(animeCommand.formatReleaseDate('2004-1-1')).toBe('2004-1-1');
    });

    it('should catch error in formatReleaseDate catch block if an error is thrown', () => {
      const errorThrowingReleaseDate = {
        get length() {
          throw new Error('Simulated length error');
        }
      };
      expect(animeCommand.formatReleaseDate(errorThrowingReleaseDate)).toBe(errorThrowingReleaseDate);
    });

    it('should stringify zero rating in createAnimeEmbed', () => {
      const embed = animeCommand.createAnimeEmbed({
        id: 1,
        title: 'Zero Rated',
        synopsis: 'A rated show.',
        rating: 0,
        genres: [{ name: 'Action' }]
      });
      expect(embed.data.fields.find(f => f.name === '⭐ MAL Rating').value).toBe('0');
    });

    it('should use Unknown title when title is missing in createAnimeEmbed', () => {
      const embed = animeCommand.createAnimeEmbed({
        id: 1,
        title: null,
        synopsis: 'Synopsis text',
        rating: 7,
        genres: [{ name: 'Action' }]
      });
      expect(embed.data.title).toBe('Unknown');
    });

    it('should use default synopsis when synopsis is missing', () => {
      const embed = animeCommand.createAnimeEmbed({
        id: 1,
        title: 'Test',
        releaseDate: '2020-01-01',
        rating: 8,
        genres: [{ name: 'Action' }]
      });
      expect(embed.data.description).toContain('No synopsis available.');
    });

    it('should correctly handle various rating types in createAnimeEmbed (covers rating branch coverage)', () => {
      // 1. rating is empty string
      const embedEmptyRating = animeCommand.createAnimeEmbed({
        id: 1,
        title: 'Title',
        synopsis: 'Synopsis',
        rating: '',
        genres: []
      });
      expect(embedEmptyRating.data.fields.find(f => f.name === '⭐ MAL Rating').value).toBe('N/A');

      // 2. rating is null
      const embedNullRating = animeCommand.createAnimeEmbed({
        id: 1,
        title: 'Title',
        synopsis: 'Synopsis',
        rating: null,
        genres: []
      });
      expect(embedNullRating.data.fields.find(f => f.name === '⭐ MAL Rating').value).toBe('N/A');

      // 3. rating is a valid rating value
      const embedValidRating = animeCommand.createAnimeEmbed({
        id: 1,
        title: 'Title',
        synopsis: 'Synopsis',
        rating: 8.5,
        genres: []
      });
      expect(embedValidRating.data.fields.find(f => f.name === '⭐ MAL Rating').value).toBe('8.5');
    });

    it('should reply with warning if no search results found (status 200 but empty/null data)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('NonexistentAnimeName')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        status: 200,
        data: { data: [] }
      });

      await animeCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No anime found matching your search. Please try a different title.'
      }));
    });

    it('should reply with warning if search response status is not 200', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Bleach')
        }
      });

      mockAxios.get.mockResolvedValueOnce({
        status: 500
      });

      await animeCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No anime found matching your search. Please try a different title.'
      }));
    });

    it('should throw API_ERROR if MAL response status is not 200', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Naruto')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('API_ERROR'));

      await animeCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to communicate with MyAnimeList API. Please try again later.'
      }));
    });

    it('should handle API_RATE_LIMIT error correctly', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Naruto')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('API_RATE_LIMIT'));

      await animeCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Rate limit exceeded. Please try again in a few minutes.'
      }));
    });

    it('should handle API_NETWORK_ERROR error correctly', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Naruto')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('API_NETWORK_ERROR'));

      await animeCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Network error: Could not connect to MyAnimeList. Please check your internet connection.'
      }));
    });

    it('should handle generic unexpected error correctly', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Naruto')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('Some unexpected offline error'));

      await animeCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in anime command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while searching. Please try again later.'
      }));
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Naruto')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('API_ERROR'));
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await animeCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for anime command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to communicate with MyAnimeList API. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Naruto')
        }
      });

      mockAxios.get.mockRejectedValueOnce(new Error('API_ERROR'));
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(animeCommand.execute(mockInteraction)).resolves.not.toThrow();
    });
  });
});
