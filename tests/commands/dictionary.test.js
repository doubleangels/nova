const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('dictionary command', () => {
  let dictionaryCommand;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    dictionaryCommand = require('../../commands/dictionary');
    jest.clearAllMocks();
  });

  it('should successfully search a word and display definitions (all fields present, phonetic present, meanings present)', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('hello')
      }
    });

    const mockWordData = [{
      word: 'hello',
      phonetic: '/həˈloʊ/',
      meanings: [{
        partOfSpeech: 'noun',
        definitions: [{
          definition: 'An utterance of "hello" as a greeting.'
        }]
      }]
    }];

    mockAxios.get.mockResolvedValueOnce({
      data: mockWordData
    });

    await dictionaryCommand.execute(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockAxios.get).toHaveBeenCalledWith('https://api.dictionaryapi.dev/api/v2/entries/en/hello', expect.any(Object));
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));

    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.title).toBe('Dictionary: hello');
    expect(sentEmbed.data.description).toBe('An utterance of "hello" as a greeting.');
    
    const fields = sentEmbed.data.fields;
    expect(fields.find(f => f.name === 'Phonetic').value).toBe('/həˈloʊ/');
    expect(fields.find(f => f.name === 'Part of Speech').value).toBe('noun');

    expect(mockLogger.info).toHaveBeenCalledWith('/dictionary command completed successfully.', expect.any(Object));
  });

  it('should fallback to phonetics text if data.phonetic is not present', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('world')
      }
    });

    const mockWordData = [{
      word: 'world',
      phonetics: [{
        text: '/wɜːld/'
      }],
      meanings: [{
        partOfSpeech: 'noun',
        definitions: [{
          definition: 'The earth, together with all of its countries and peoples.'
        }]
      }]
    }];

    mockAxios.get.mockResolvedValueOnce({
      data: mockWordData
    });

    await dictionaryCommand.execute(mockInteraction);

    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.fields.find(f => f.name === 'Phonetic').value).toBe('/wɜːld/');
  });

  it('should handle missing meanings and definition gracefully (meanings empty, phonetics empty, definitions empty)', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('empty')
      }
    });

    const mockWordData = [{
      word: 'empty',
      meanings: []
    }];

    mockAxios.get.mockResolvedValueOnce({
      data: mockWordData
    });

    await dictionaryCommand.execute(mockInteraction);

    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.description).toBe('No definition found.');
    expect(sentEmbed.data.fields.find(f => f.name === 'Phonetic').value).toBe('N/A');
    expect(sentEmbed.data.fields.find(f => f.name === 'Part of Speech').value).toBe('Unknown');
  });

  it('should handle case where meanings has no definitions', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('empty-defs')
      }
    });

    const mockWordData = [{
      word: 'empty-defs',
      meanings: [{
        partOfSpeech: 'verb',
        definitions: []
      }]
    }];

    mockAxios.get.mockResolvedValueOnce({
      data: mockWordData
    });

    await dictionaryCommand.execute(mockInteraction);

    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.description).toBe('No definition found.');
    expect(sentEmbed.data.fields.find(f => f.name === 'Part of Speech').value).toBe('verb');
  });

  it('should reply with warning if no data is found in response array', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('Nonexistent')
      }
    });

    mockAxios.get.mockResolvedValueOnce({
      data: []
    });

    await dictionaryCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ No definitions found for that word.'
    }));
  });

  it('should handle all custom error types in handleError', async () => {
    const errorCases = [
      {
        error: { response: { status: 404 } },
        expected: '⚠️ No definitions found for your search word.'
      },
      {
        error: { code: 'ECONNABORTED' },
        expected: '⚠️ Request timed out. Please try again later.'
      },
      {
        error: new Error('Network error occurred'),
        expected: '⚠️ Network error occurred. Please check your internet connection.'
      },
      {
        error: new Error('Generic unexpected error'),
        expected: '⚠️ An unexpected error occurred while searching the dictionary. Please try again later.'
      }
    ];

    for (const errCase of errorCases) {
      jest.clearAllMocks();
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('word')
        }
      });

      mockAxios.get.mockRejectedValueOnce(errCase.error);

      await dictionaryCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in dictionary command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: errCase.expected
      }));
    }
  });

  it('should fallback to reply if editReply fails inside error catch block', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('word')
      }
    });

    const error = new Error('Network offline');
    mockAxios.get.mockRejectedValueOnce(error);
    mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

    await dictionaryCommand.execute(mockInteraction);

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for dictionary command.', expect.any(Object));
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ Network error occurred. Please check your internet connection.'
    }));
  });

  it('should silently catch errors if fallback reply also fails inside catch block', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('word')
      }
    });

    const error = new Error('Network offline');
    mockAxios.get.mockRejectedValueOnce(error);
    mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
    mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

    await expect(dictionaryCommand.execute(mockInteraction)).resolves.not.toThrow();
  });
});
