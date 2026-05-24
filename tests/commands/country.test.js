const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

describe('country command', () => {
  let countryCommand;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    countryCommand = require('../../commands/country');
    jest.clearAllMocks();
  });

  it('should successfully fetch and display information for a country (all fields populated, latlng present, currencies with symbol, png flag)', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('France')
      }
    });

    const mockCountryData = [{
      name: { common: 'France', official: 'French Republic' },
      flags: { png: 'http://france-png' },
      capital: ['Paris'],
      population: 67390000,
      region: 'Europe',
      subregion: 'Western Europe',
      area: 643801,
      currencies: { EUR: { name: 'Euro', symbol: '€' } },
      latlng: [46, 2]
    }];

    mockAxios.get.mockResolvedValueOnce({
      data: mockCountryData
    });

    await countryCommand.execute(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockAxios.get).toHaveBeenCalledWith('https://restcountries.com/v3.1/name/France', expect.any(Object));
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));

    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.title).toBe('France');
    expect(sentEmbed.data.description).toBe('French Republic');
    expect(sentEmbed.data.thumbnail.url).toBe('http://france-png');
    
    const fields = sentEmbed.data.fields;
    expect(fields.find(f => f.name === '🏛️ Capital').value).toBe('Paris');
    expect(fields.find(f => f.name === '💱 Currencies').value).toBe('Euro (€)');
    expect(fields.find(f => f.name === '🗺️ Google Maps').value).toContain('query=46,2');

    expect(mockLogger.info).toHaveBeenCalledWith('/country command completed successfully.', expect.any(Object));
  });

  it('should format optional fields correctly (capital as non-array, svg flag, latlng missing, currencies without symbol, missing official name)', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('Nippon')
      }
    });

    const mockCountryData = [{
      name: { common: 'Japan' },
      flags: { svg: 'http://japan-svg' },
      capital: 'Tokyo',
      population: 125800000,
      region: 'Asia',
      subregion: 'Eastern Asia',
      area: 377975,
      currencies: { JPY: { name: 'Japanese Yen' } }
    }];

    mockAxios.get.mockResolvedValueOnce({
      data: mockCountryData
    });

    await countryCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalled();
    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.title).toBe('Japan');
    expect(sentEmbed.data.description).toBe('Japan');
    expect(sentEmbed.data.thumbnail.url).toBe('http://japan-svg');

    const fields = sentEmbed.data.fields;
    expect(fields.find(f => f.name === '🏛️ Capital').value).toBe('Tokyo');
    expect(fields.find(f => f.name === '💱 Currencies').value).toBe('Japanese Yen ()');
    expect(fields.find(f => f.name === '🗺️ Google Maps').value).toContain('query=Japan');
  });

  it('should handle array fallback flags and missing optional properties gracefully (capital null, region/subregion/area/population/currencies null)', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('Atlantis')
      }
    });

    const mockCountryData = [{
      name: { common: 'Atlantis' },
      flags: ['http://atlantis-flag-array'],
      capital: null,
      population: null,
      region: null,
      subregion: null,
      area: null,
      currencies: null
    }];

    mockAxios.get.mockResolvedValueOnce({
      data: mockCountryData
    });

    await countryCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalled();
    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.thumbnail.url).toBe('http://atlantis-flag-array');

    const fields = sentEmbed.data.fields;
    expect(fields.find(f => f.name === '🏛️ Capital').value).toBe('N/A');
    expect(fields.find(f => f.name === '👥 Population').value).toBe('N/A');
    expect(fields.find(f => f.name === '📐 Area').value).toBe('N/A');
    expect(fields.find(f => f.name === '💱 Currencies').value).toBe('N/A');
  });

  it('should handle missing flags gracefully (no thumbnail set)', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('NoFlagCountry')
      }
    });

    const mockCountryData = [{
      name: { common: 'NoFlagCountry' },
      flags: null,
      capital: null,
      population: null,
      region: null,
      subregion: null,
      area: null,
      currencies: null
    }];

    mockAxios.get.mockResolvedValueOnce({
      data: mockCountryData
    });

    await countryCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalled();
    const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.thumbnail).toBeUndefined();
  });

  it('should reply with warning if no country results are found in response', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('Nonexistent')
      }
    });

    mockAxios.get.mockResolvedValueOnce({
      data: []
    });

    await countryCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ No country found with that name.'
    }));
    expect(mockLogger.warn).toHaveBeenCalledWith('/country no results found.', expect.any(Object));
  });

  it('should reply with warning if response data is not an array', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('Nonexistent')
      }
    });

    mockAxios.get.mockResolvedValueOnce({
      data: null
    });

    await countryCommand.execute(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ No country found with that name.'
    }));
  });

  it('should handle all custom error types in handleError', async () => {
    const errorCases = [
      {
        error: { response: { status: 404 } },
        expected: '⚠️ No country found with that name.'
      },
      {
        error: { code: 'ECONNABORTED' },
        expected: '⚠️ Request timed out. Please try again later.'
      },
      {
        error: new Error('Network error has occurred'),
        expected: '⚠️ Network error occurred. Please check your internet connection.'
      },
      {
        error: new Error('Unexpected database down'),
        expected: '⚠️ An unexpected error occurred while searching for the country. Please try again later.'
      }
    ];

    for (const errCase of errorCases) {
      jest.clearAllMocks();
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('France')
        }
      });

      mockAxios.get.mockRejectedValueOnce(errCase.error);

      await countryCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error occurred in country command.', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: errCase.expected
      }));
    }
  });

  it('should fallback to reply if editReply fails inside error catch block', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('France')
      }
    });

    const error = new Error('Network offline');
    mockAxios.get.mockRejectedValueOnce(error);
    mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

    await countryCommand.execute(mockInteraction);

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for country command.', expect.any(Object));
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: '⚠️ Network error occurred. Please check your internet connection.'
    }));
  });

  it('should silently catch errors if fallback reply also fails inside catch block', async () => {
    const mockInteraction = createMockInteraction({
      options: {
        getString: jest.fn().mockReturnValue('France')
      }
    });

    const error = new Error('Network offline');
    mockAxios.get.mockRejectedValueOnce(error);
    mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
    mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

    await expect(countryCommand.execute(mockInteraction)).resolves.not.toThrow();
  });
});
