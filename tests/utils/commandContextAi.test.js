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

  it('should return null when normalizeNoteResponse receives null or empty note', () => {
    expect(contextAi.normalizeNoteResponse(null)).toBeNull();
    expect(contextAi.normalizeNoteResponse({})).toBeNull();
    expect(contextAi.normalizeNoteResponse({ note: '   ' })).toBeNull();
  });

  it('should use summary field as fallback when note is absent', () => {
    const ctx = contextAi.normalizeNoteResponse({ summary: 'Use search.' });
    expect(ctx?.note).toBe('Use search.');
  });

  it('should return null when Gemini request fails inside fetchCommandContext', async () => {
    mockAxios.post.mockRejectedValueOnce(new Error('network'));
    const ctx = await contextAi.fetchWeatherContext({
      place: 'Austin, TX',
      summary: 'Clear',
      forecastSnippet: 'sunny',
      units: 'metric'
    });
    expect(ctx).toBeNull();
  });

  it('should return null when Gemini returns invalid payload', async () => {
    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/w1' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [
            { content: { parts: [{ text: '{"bad":"payload"}' }] } }
          ]
        }
      });
    const ctx = await contextAi.fetchWeatherContext({
      place: 'Austin, TX',
      summary: 'Clear',
      forecastSnippet: 'sunny',
      units: 'metric'
    });
    expect(ctx).toBeNull();
  });

  it('should fetch IMDB context when enabled', async () => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiContextCacheTtlSeconds: 3600,
      geminiCommandContextCacheTtlMs: 3600000,
      imdbAiEnabled: true
    }));
    const imdbAi = require('../../utils/commandContextAi');

    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/imdb1' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ note: 'Won 3 Oscars.' }) }] } }]
        }
      });

    const ctx = await imdbAi.fetchImdbContext({
      title: 'Inception',
      year: '2010',
      typeLabel: 'Movie',
      imdbId: 'tt1375666',
      rating: '8.8',
      genre: 'Sci-Fi',
      plotSnippet: 'A thief...'
    });
    expect(ctx?.note).toContain('Oscars');
  });

  it('should fetch book context when enabled', async () => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiContextCacheTtlSeconds: 3600,
      geminiCommandContextCacheTtlMs: 3600000,
      bookAiEnabled: true
    }));
    const bookAi = require('../../utils/commandContextAi');

    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/book1' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ note: 'Bestseller for 52 weeks.' }) }] } }]
        }
      });

    const ctx = await bookAi.fetchBookContext({
      title: 'The Alchemist',
      authors: 'Paulo Coelho',
      bookId: 'abc123',
      publishedDate: '1988',
      rating: '4.7',
      descriptionSnippet: 'A shepherd...'
    });
    expect(ctx?.note).toContain('Bestseller');
  });

  it('should fetch google search context when enabled', async () => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiContextCacheTtlSeconds: 3600,
      geminiCommandContextCacheTtlMs: 3600000,
      googleAiEnabled: true
    }));
    const googleAi = require('../../utils/commandContextAi');

    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/google1' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ note: 'Official docs.' }) }] } }]
        }
      });

    const ctx = await googleAi.fetchGoogleSearchContext({
      query: 'jest testing',
      resultTitle: 'Jest docs',
      resultSnippet: 'A delightful testing framework',
      resultLink: 'https://jestjs.io',
      resultIndex: 0
    });
    expect(ctx?.note).toContain('Official');
  });

  it('should fetch google images context when enabled', async () => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiContextCacheTtlSeconds: 3600,
      geminiCommandContextCacheTtlMs: 3600000,
      googleImagesAiEnabled: true
    }));
    const googleImagesAi = require('../../utils/commandContextAi');

    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/gi1' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ note: 'Aerial photo of Paris.' }) }] } }]
        }
      });

    const ctx = await googleImagesAi.fetchGoogleImagesContext({
      query: 'Eiffel Tower',
      title: 'Eiffel Tower aerial',
      contextLink: 'https://example.com/photo',
      imageLink: 'https://example.com/photo.jpg',
      resultIndex: 0
    });
    expect(ctx?.note).toContain('Paris');
  });

  it('should use default TTL when geminiCommandContextCacheTtlMs is not set', async () => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiContextCacheTtlSeconds: 3600,
      // geminiCommandContextCacheTtlMs deliberately absent
      weatherAiEnabled: true
    }));
    const noTtlAi = require('../../utils/commandContextAi');

    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/w2' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ note: 'Mild weather.' }) }] } }]
        }
      });

    const ctx = await noTtlAi.fetchWeatherContext({
      place: 'Denver',
      summary: 'Mild',
      forecastSnippet: 'mild',
      units: 'metric'
    });
    expect(ctx?.note).toBe('Mild weather.');
  });
});
