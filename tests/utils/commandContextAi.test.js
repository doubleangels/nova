describe('commandContextAi', () => {
  let mockAxios;
  let contextAi;

  beforeEach(() => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiContextCacheTtlSeconds: 3600,
      geminiCommandContextCacheTtlMs: 3600000,
      weatherAiEnabled: true,
      animeAiEnabled: false,
      imdbAiEnabled: false,
      bookAiEnabled: false,
      googleAiEnabled: false,
      googleImagesAiEnabled: false
    }));
    contextAi = require('../../utils/commandContextAi');
  });

  it('should normalize note responses', () => {
    const ctx = contextAi.normalizeNoteResponse({ note: '  Pack an umbrella.  ' });
    expect(ctx?.note).toBe('Pack an umbrella.');
    expect(ctx?.model).toBe('gemini-3.1-flash-lite');
  });

  it('should fetch and cache weather context', async () => {
    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/weather1' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ note: 'Heat advisory possible Friday.' }) }]
              }
            }
          ]
        }
      });

    const first = await contextAi.fetchWeatherContext({
      place: 'Austin, TX',
      summary: 'Clear',
      forecastSnippet: 'Mon: sunny',
      units: 'metric'
    });
    const second = await contextAi.fetchWeatherContext({
      place: 'Austin, TX',
      summary: 'Clear',
      forecastSnippet: 'Mon: sunny',
      units: 'metric'
    });

    expect(first?.note).toContain('Heat advisory');
    expect(second).toEqual(first);
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
  });

  it('should fetch anime context when enabled', async () => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiContextCacheTtlSeconds: 3600,
      geminiCommandContextCacheTtlMs: 3600000,
      weatherAiEnabled: false,
      animeAiEnabled: true,
      imdbAiEnabled: false,
      bookAiEnabled: false
    }));
    const animeAi = require('../../utils/commandContextAi');

    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/anime1' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ note: 'Season 2 airing now.' }) }]
              }
            }
          ]
        }
      });

    const ctx = await animeAi.fetchAnimeContext({
      title: 'Frieren',
      malId: 123,
      rating: '9.0',
      genres: 'Fantasy',
      releaseDate: '2023',
      synopsisSnippet: 'After the party...'
    });
    expect(ctx?.note).toContain('Season 2');
  });

  it('should return null when weather AI is disabled', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      geminiApiKey: 'key',
      weatherAiEnabled: false
    }));
    const disabled = require('../../utils/commandContextAi');
    const ctx = await disabled.fetchWeatherContext({
      place: 'Paris',
      summary: 'Rain',
      forecastSnippet: 'wet',
      units: 'metric'
    });
    expect(ctx).toBeNull();
  });
});
