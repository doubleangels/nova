const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

const mockCreatePaginatedResults = jest.fn();
jest.mock('../../utils/searchUtils', () => ({
  createPaginatedResults: mockCreatePaginatedResults
}));

describe('book command', () => {
  let bookCommand;
  let mockConfig;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockConfig = {
      googleApiKey: 'google-api-key-xyz'
    };
    jest.doMock('../../config', () => mockConfig);

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    bookCommand = require('../../commands/book');
    jest.clearAllMocks();
  });

  describe('extractISBN', () => {
    it('should extract correct ISBN', () => {
      const identifiers = [
        { type: 'ISBN_10', identifier: '1234567890' },
        { type: 'ISBN_13', identifier: '9781234567890' }
      ];
      expect(bookCommand.extractISBN(identifiers, 'ISBN_10')).toBe('1234567890');
      expect(bookCommand.extractISBN(identifiers, 'ISBN_13')).toBe('9781234567890');
      expect(bookCommand.extractISBN(identifiers, 'OTHER')).toBeNull();
      expect(bookCommand.extractISBN(null, 'ISBN_10')).toBeNull();
    });
  });

  describe('formatNumber', () => {
    it('should format number with commas', () => {
      expect(bookCommand.formatNumber(123)).toBe('123');
      expect(bookCommand.formatNumber(1234)).toBe('1,234');
      expect(bookCommand.formatNumber(1234567)).toBe('1,234,567');
    });
  });

  describe('truncateDescription', () => {
    it('should return default description if null or empty', () => {
      expect(bookCommand.truncateDescription(null)).toBe('No description available');
      expect(bookCommand.truncateDescription('')).toBe('No description available');
    });

    it('should return original text if within limit', () => {
      expect(bookCommand.truncateDescription('Short description')).toBe('Short description');
    });

    it('should truncate and add ellipses if over limit', () => {
      const longText = 'a'.repeat(2005);
      const expected = 'a'.repeat(1997) + '...';
      expect(bookCommand.truncateDescription(longText)).toBe(expected);
    });
  });

  describe('searchBooks', () => {
    it('should throw error if googleApiKey is missing', async () => {
      mockConfig.googleApiKey = null;
      const result = await bookCommand.searchBooks('Node.js');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Google Books API key is not configured.');
    });

    it('should return null if API returns no items', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: { items: [] }
      });
      const result = await bookCommand.searchBooks('Node.js');
      expect(result).toBeNull();
    });

    it('should return parsed books if API returns volumes', async () => {
      const mockVolume = {
        id: 'vol-1',
        volumeInfo: {
          title: 'JS Guide',
          authors: ['John Doe'],
          description: 'A great book',
          publishedDate: '2020-01-01',
          pageCount: 300,
          categories: ['Tech'],
          averageRating: 4.5,
          ratingsCount: 12,
          language: 'en',
          publisher: 'O-Reilly',
          industryIdentifiers: [
            { type: 'ISBN_10', identifier: '1234567890' }
          ],
          imageLinks: {
            thumbnail: 'http://image.com'
          },
          previewLink: 'http://preview.com',
          infoLink: 'http://info.com',
          maturityRating: 'NOT_MATURE'
        }
      };

      mockAxios.get.mockResolvedValueOnce({
        data: { items: [mockVolume] }
      });

      const result = await bookCommand.searchBooks('JS Guide', 5);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        title: 'JS Guide',
        authors: ['John Doe'],
        isbn10: '1234567890'
      }));
    });

    it('should return parsed books with missing fields using default fallbacks in searchBooks', async () => {
      const mockVolume = {
        id: 'vol-2',
        volumeInfo: {
          title: null,
          authors: null,
          description: null,
          publishedDate: null,
          pageCount: null,
          categories: null,
          averageRating: null,
          ratingsCount: 0,
          language: null,
          publisher: null,
          industryIdentifiers: null,
          imageLinks: null,
          previewLink: null,
          infoLink: null,
          maturityRating: null
        }
      };

      mockAxios.get.mockResolvedValueOnce({
        data: { items: [mockVolume] }
      });

      const result = await bookCommand.searchBooks('JS Guide', 5);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        title: 'Unknown Title',
        authors: ['Unknown Author'],
        description: 'No description available',
        publishedDate: 'Unknown',
        pageCount: 'Unknown',
        categories: [],
        averageRating: null,
        ratingsCount: 0,
        language: 'Unknown',
        publisher: 'Unknown',
        isbn10: null,
        isbn13: null,
        imageUrl: null,
        previewLink: null,
        infoLink: null,
        maturityRating: 'NOT_MATURE'
      }));
    });

    it('should handle searchBooks general exception by catching and logging', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Network offline'));
      const result = await bookCommand.searchBooks('JS Guide');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to search for books.', expect.any(Object));
    });
  });

  describe('searchByISBN', () => {
    it('should throw error if googleApiKey is missing', async () => {
      mockConfig.googleApiKey = null;
      const result = await bookCommand.searchByISBN('978-3-16-148410-0');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Google Books API key is not configured.');
    });

    it('should return null if ISBN search returns no items', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: { items: null }
      });
      const result = await bookCommand.searchByISBN('9783161484100');
      expect(result).toBeNull();
    });

    it('should parse book correctly with cleaned ISBN hyphens/spaces', async () => {
      const mockVolume = {
        id: 'vol-isbn',
        volumeInfo: {
          title: null,
          authors: null,
          description: null,
          publishedDate: null,
          pageCount: null,
          categories: null,
          averageRating: null,
          ratingsCount: 0,
          language: null,
          publisher: null,
          industryIdentifiers: null,
          imageLinks: null,
          previewLink: null,
          infoLink: null,
          maturityRating: null
        },
        searchInfo: null
      };

      mockAxios.get.mockResolvedValueOnce({
        data: { items: [mockVolume] }
      });

      const result = await bookCommand.searchByISBN('978-3-16-148410-0');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Unknown Title');
      expect(result[0].authors).toEqual(['Unknown Author']);
      expect(result[0].description).toBe('No description available');
      expect(result[0].publishedDate).toBe('Unknown');
      expect(result[0].pageCount).toBe('Unknown');
      expect(result[0].isbn10).toBeNull();
    });

    it('should parse book correctly when all fields are populated in searchByISBN', async () => {
      const mockVolume = {
        id: 'vol-isbn-2',
        volumeInfo: {
          title: 'Complete ISBN Book',
          authors: ['Author 1'],
          description: 'Description 1',
          publishedDate: '2020',
          pageCount: 300,
          categories: ['Tech'],
          averageRating: 4.5,
          ratingsCount: 10,
          language: 'en',
          publisher: 'Publisher 1',
          industryIdentifiers: [
            { type: 'ISBN_10', identifier: '1234567890' },
            { type: 'ISBN_13', identifier: '9781234567890' }
          ],
          imageLinks: { thumbnail: 'http://image' },
          previewLink: 'http://prev',
          infoLink: 'http://info',
          maturityRating: 'MATURE'
        }
      };

      mockAxios.get.mockResolvedValueOnce({
        data: { items: [mockVolume] }
      });

      const result = await bookCommand.searchByISBN('978-3-16-148410-0');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        title: 'Complete ISBN Book',
        authors: ['Author 1'],
        description: 'Description 1',
        publishedDate: '2020',
        pageCount: 300,
        categories: ['Tech'],
        averageRating: 4.5,
        ratingsCount: 10,
        language: 'en',
        publisher: 'Publisher 1',
        isbn10: '1234567890',
        isbn13: '9781234567890',
        imageUrl: 'http://image',
        previewLink: 'http://prev',
        infoLink: 'http://info',
        maturityRating: 'MATURE'
      }));
    });

    it('should handle searchByISBN general exception by catching and logging', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('ISBN Search Failed'));
      const result = await bookCommand.searchByISBN('12345');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to search for book by ISBN.', expect.any(Object));
    });
  });

  describe('createBookEmbed', () => {
    it('should throw error if book is undefined or index out of bounds', () => {
      expect(() => bookCommand.createBookEmbed([], 0)).toThrow('No book data available');
    });

    it('should support default index value (index = 0)', () => {
      const books = [{
        index: 0,
        title: 'Complete Title',
        authors: ['Author A'],
        description: 'Complete description text',
        publishedDate: '2021',
        pageCount: 150,
        categories: ['Genre 1'],
        averageRating: 4.8,
        ratingsCount: 50,
        language: 'en',
        publisher: 'Pub House',
        isbn10: '1010101010',
        isbn13: '1313131313131',
        imageUrl: 'http://img.png',
        previewLink: 'http://prev',
        infoLink: 'http://info'
      }];
      const embed = bookCommand.createBookEmbed(books);
      expect(embed.data.title).toBe('Complete Title');
    });

    it('should render all fields when they are provided', () => {
      const books = [{
        index: 0,
        title: 'Complete Title',
        authors: ['Author A', 'Author B'],
        description: 'Complete description text',
        publishedDate: '2021',
        pageCount: 150,
        categories: ['Genre 1', 'Genre 2'],
        averageRating: 4.8,
        ratingsCount: 50,
        language: 'en',
        publisher: 'Pub House',
        isbn10: '1010101010',
        isbn13: '1313131313131',
        imageUrl: 'http://img.png',
        previewLink: 'http://prev',
        infoLink: 'http://info'
      }];

      const embed = bookCommand.createBookEmbed(books, 0);
      expect(embed.data.title).toBe('Complete Title');
      expect(embed.data.url).toBe('http://info');
      expect(embed.data.thumbnail.url).toBe('http://img.png');
      expect(embed.data.fields).toHaveLength(10);
    });

    it('should omit fields when they are missing or default values', () => {
      const books = [{
        index: 0,
        title: 'Minimal Book',
        authors: [],
        description: '',
        publishedDate: 'Unknown',
        pageCount: 'Unknown',
        categories: [],
        averageRating: null,
        ratingsCount: 0,
        language: 'Unknown',
        publisher: 'Unknown',
        isbn10: null,
        isbn13: null,
        imageUrl: null,
        previewLink: null,
        infoLink: null
      }];

      const embed = bookCommand.createBookEmbed(books, 0);
      expect(embed.data.title).toBe('Minimal Book');
      expect(embed.data.thumbnail).toBeUndefined();
      expect(embed.data.url).toBeUndefined();
      expect(embed.data.fields).toBeUndefined();
    });
  });

  describe('execute', () => {
    it('should search books and set paginated search results', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('search'),
          getString: jest.fn().mockReturnValue('javascript'),
          getInteger: jest.fn().mockReturnValue(3),
          getBoolean: jest.fn().mockReturnValue(false)
        }
      });

      const mockBooks = [
        {
          title: 'JS 1',
          description: 'JS 1 description',
          authors: ['Author 1'],
          publishedDate: '2020',
          pageCount: 300,
          language: 'en',
          publisher: 'Publisher 1',
          categories: ['Cat 1'],
          isbn10: '1234567890',
          isbn13: '1234567890123',
          previewLink: 'http://prev',
          infoLink: 'http://info',
          imageUrl: 'http://img'
        },
        {
          title: 'JS 2',
          description: 'JS 2 description',
          authors: ['Author 2'],
          publishedDate: '2021',
          pageCount: 400,
          language: 'en',
          publisher: 'Publisher 2',
          categories: ['Cat 2'],
          isbn10: '0987654321',
          isbn13: '3210987654321',
          previewLink: 'http://prev2',
          infoLink: 'http://info2',
          imageUrl: 'http://img2'
        }
      ];
      jest.spyOn(bookCommand, 'searchBooks').mockResolvedValueOnce(mockBooks);

      mockCreatePaginatedResults.mockImplementationOnce(async (inter, items, generateEmbed) => {
        // Trigger embed generation
        const embed = generateEmbed(0);
        expect(embed.data.title).toBe('JS 1');
      });

      await bookCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(bookCommand.searchBooks).toHaveBeenCalledWith('javascript', 3);
      expect(mockCreatePaginatedResults).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('/book command completed successfully.', expect.any(Object));
    });

    it('should search books by isbn', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('isbn'),
          getString: jest.fn().mockReturnValue('1234567890'),
          getInteger: jest.fn().mockReturnValue(null),
          getBoolean: jest.fn().mockReturnValue(false)
        }
      });

      const mockBooks = [
        {
          title: 'ISBN Book',
          description: 'ISBN description',
          authors: ['Author 1'],
          publishedDate: '2020',
          pageCount: 300,
          language: 'en',
          publisher: 'Publisher 1',
          categories: ['Cat 1'],
          isbn10: '1234567890',
          isbn13: '1234567890123',
          previewLink: 'http://prev',
          infoLink: 'http://info',
          imageUrl: 'http://img'
        }
      ];
      jest.spyOn(bookCommand, 'searchByISBN').mockResolvedValueOnce(mockBooks);

      await bookCommand.execute(mockInteraction);

      expect(bookCommand.searchByISBN).toHaveBeenCalledWith('1234567890');
      expect(mockCreatePaginatedResults).toHaveBeenCalled();
    });

    it('should reply with no books found warning if results are null or empty', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('search'),
          getString: jest.fn().mockReturnValue('unknownQuery'),
          getInteger: jest.fn().mockReturnValue(null),
          getBoolean: jest.fn().mockReturnValue(false)
        }
      });

      jest.spyOn(bookCommand, 'searchBooks').mockResolvedValueOnce([]);

      await bookCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ No books found for your search.'
      }));
    });

    it('should handle all custom error types in handleError', async () => {
      const errorTypes = [
        { msg: 'API_ERROR', expected: '⚠️ Failed to search Google Books. Please try again later.' },
        { msg: 'API_RATE_LIMIT', expected: '⚠️ Rate limit exceeded. Please try again in a few minutes.' },
        { msg: 'API_NETWORK_ERROR', expected: '⚠️ Network error occurred. Please check your internet connection.' },
        { msg: 'NO_RESULTS', expected: '⚠️ No books found for your search.' },
        { msg: 'INVALID_ISBN', expected: '⚠️ Please provide a valid ISBN (10 or 13 digits).' },
        { msg: 'INVALID_QUERY', expected: '⚠️ Please provide a valid search query.' },
        { msg: 'API_KEY_MISSING', expected: '⚠️ This command is not properly configured. Please contact an administrator.' },
        { msg: 'SOME_GENERIC_ERROR', expected: '⚠️ An unexpected error occurred while searching for books. Please try again later.' }
      ];

      for (const errType of errorTypes) {
        jest.clearAllMocks();
        const mockInteraction = createMockInteraction({
          options: {
            getSubcommand: jest.fn().mockReturnValue('search'),
            getString: jest.fn().mockReturnValue('js'),
            getInteger: jest.fn().mockReturnValue(null),
            getBoolean: jest.fn().mockReturnValue(false)
          }
        });

        jest.spyOn(bookCommand, 'searchBooks').mockRejectedValueOnce(new Error(errType.msg));

        await bookCommand.execute(mockInteraction);

        expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in book command.', expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: errType.expected
        }));
      }
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('search'),
          getString: jest.fn().mockReturnValue('js'),
          getInteger: jest.fn().mockReturnValue(null),
          getBoolean: jest.fn().mockReturnValue(false)
        }
      });

      jest.spyOn(bookCommand, 'searchBooks').mockRejectedValueOnce(new Error('API_ERROR'));
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await bookCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for book command.', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to search Google Books. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getSubcommand: jest.fn().mockReturnValue('search'),
          getString: jest.fn().mockReturnValue('js'),
          getInteger: jest.fn().mockReturnValue(null),
          getBoolean: jest.fn().mockReturnValue(false)
        }
      });

      jest.spyOn(bookCommand, 'searchBooks').mockRejectedValueOnce(new Error('API_ERROR'));
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(bookCommand.execute(mockInteraction)).resolves.not.toThrow();
    });
  });
});
