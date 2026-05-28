describe('matchPredictionAi', () => {
  let mockAxios;
  let ai;

  beforeEach(() => {
    jest.resetModules();
    mockAxios = { post: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      predictionAiEnabled: true,
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiPredictionCacheTtlMs: 0,
      geminiContextCacheTtlSeconds: 3600
    }));
    ai = require('../../utils/matchPredictionAi');
    ai.clearAiPredictionCache([900001, 910001]);
  });

  it('should be disabled without API key', () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      predictionAiEnabled: true,
      geminiApiKey: '',
      geminiPredictionModel: 'gemini-3.1-flash-lite'
    }));
    const disabled = require('../../utils/matchPredictionAi');
    expect(disabled.isMatchAiEnabled()).toBe(false);
  });

  it('should cap reasoning length when normalizing', () => {
    const pick = ai.normalizeAiResponse(
      {
        homeScore: 1,
        awayScore: 0,
        winner: 'home',
        reasoning: 'a'.repeat(200)
      },
      { home: 'Brazil', away: 'Argentina' }
    );
    expect(pick?.reasoning.length).toBeLessThanOrEqual(120);
  });

  it('should normalize valid Gemini JSON payloads', () => {
    const pick = ai.normalizeAiResponse(
      {
        homeScore: 2,
        awayScore: 1,
        winner: 'home',
        reasoning: 'Home side looks stronger.'
      },
      { home: 'Brazil', away: 'Argentina' }
    );
    expect(pick).toEqual({
      homeScore: 2,
      awayScore: 1,
      resultPick: 'home',
      reasoning: 'Home side looks stronger.',
      model: 'gemini-3.1-flash-lite'
    });
  });

  it('should align winner with score when model disagrees', () => {
    const pick = ai.normalizeAiResponse(
      {
        homeScore: 1,
        awayScore: 1,
        winner: 'home',
        reasoning: 'Tight match.'
      },
      { home: 'Brazil', away: 'Argentina' }
    );
    expect(pick?.resultPick).toBe('draw');
  });

  it('should treat mock API fixtures as real matches in demo mode prompts', () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      predictionAiEnabled: true,
      predictionMockApi: true,
      geminiApiKey: 'gemini-test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite'
    }));
    const demoAi = require('../../utils/matchPredictionAi');
    expect(demoAi.isDemoPredictionMode()).toBe(true);

    const prompt = demoAi.buildUserPrompt({
      game: 'worldcup',
      demoMode: true,
      fixture: {
        id: 900001,
        home: 'Brazil',
        away: 'Argentina',
        kickoff: '2026-06-12T18:00:00Z',
        status: 'NS'
      }
    });
    expect(prompt).toContain('predict as for a REAL match');
    expect(prompt).not.toContain('do not research');

    const system = demoAi.buildSystemInstruction(true);
    expect(system).toContain('test mode');
    expect(system).toContain('Do not mention demos');
  });

  it('should build a grounded Gemini request with search and structured JSON', () => {
    const body = ai.buildGeminiRequestBody(
      ai.buildUserPrompt({
        game: 'worldcup',
        fixture: {
          id: 1,
          home: 'Brazil',
          away: 'Argentina',
          kickoff: '2026-06-12T18:00:00Z',
          status: 'NS'
        }
      }),
      false,
      'cachedContents/abc123'
    );
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.cachedContent).toBe('cachedContents/abc123');
    expect(body.systemInstruction).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    const userText = body.contents[0].parts[0].text;
    expect(userText).toContain('Google Search');
    expect(userText).toContain('Brazil');
    expect(userText).toContain('Recent results and form');
  });

  it('should fetch and cache predictions from Gemini', async () => {
    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/sys1' } })
      .mockResolvedValueOnce({
        data: {
          usageMetadata: { cached_content_token_count: 400, prompt_token_count: 500 },
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      homeScore: 1,
                      awayScore: 0,
                      winner: 'home',
                      reasoning: 'Slight home edge.'
                    })
                  }
                ]
              }
            }
          ]
        }
      });

    const fixture = {
      id: 900001,
      home: 'Brazil',
      away: 'Argentina',
      kickoff: '2026-06-12T18:00:00Z',
      status: 'NS'
    };

    const first = await ai.fetchMatchAiPrediction({ game: 'worldcup', fixture });
    const second = await ai.fetchMatchAiPrediction({ game: 'worldcup', fixture });

    expect(first?.homeScore).toBe(1);
    expect(second).toEqual(first);
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
    expect(mockAxios.post.mock.calls[0][0]).toContain('cachedContents');
    expect(mockAxios.post.mock.calls[1][0]).toContain('gemini-3.1-flash-lite');
    expect(mockAxios.post.mock.calls[1][1].cachedContent).toBe('cachedContents/sys1');
    expect(mockAxios.post.mock.calls[1][1].tools).toEqual([{ google_search: {} }]);
  });

  it('should reuse system context cache across fixtures in the same mode', async () => {
    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/sys1' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      homeScore: 2,
                      awayScore: 2,
                      winner: 'draw',
                      reasoning: 'Even.'
                    })
                  }
                ]
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      homeScore: 1,
                      awayScore: 0,
                      winner: 'home',
                      reasoning: 'Home.'
                    })
                  }
                ]
              }
            }
          ]
        }
      });

    const fixtureA = {
      id: 900001,
      home: 'Brazil',
      away: 'Argentina',
      kickoff: '2026-06-12T18:00:00Z',
      status: 'NS'
    };
    const fixtureB = {
      id: 900002,
      home: 'France',
      away: 'Germany',
      kickoff: '2026-06-13T18:00:00Z',
      status: 'NS'
    };

    await ai.fetchMatchAiPrediction({ game: 'worldcup', fixture: fixtureA });
    await ai.fetchMatchAiPrediction({ game: 'worldcup', fixture: fixtureB });

    expect(mockAxios.post).toHaveBeenCalledTimes(3);
    expect(mockAxios.post.mock.calls.filter(c => c[0].includes('cachedContents'))).toHaveLength(1);
  });

  it('should return null when Gemini request fails', async () => {
    mockAxios.post.mockRejectedValue(new Error('network'));
    const pick = await ai.fetchMatchAiPrediction({
      game: 'club',
      fixture: { id: 910001, home: 'Arsenal', away: 'Chelsea' }
    });
    expect(pick).toBeNull();
  });

  it('should return null from normalizeAiResponse when scores are invalid', () => {
    // negative score
    expect(ai.normalizeAiResponse({ homeScore: -1, awayScore: 0, winner: 'home', reasoning: 'x' },
      { home: 'A', away: 'B' })).toBeNull();
    // score > 15
    expect(ai.normalizeAiResponse({ homeScore: 0, awayScore: 16, winner: 'away', reasoning: 'x' },
      { home: 'A', away: 'B' })).toBeNull();
    // non-numeric
    expect(ai.normalizeAiResponse({ homeScore: 'abc', awayScore: 0, winner: 'home', reasoning: 'x' },
      { home: 'A', away: 'B' })).toBeNull();
    // null input
    expect(ai.normalizeAiResponse(null, { home: 'A', away: 'B' })).toBeNull();
  });

  it('should resolve winner by team name in parseWinnerPick via normalizeAiResponse', () => {
    const pick = ai.normalizeAiResponse(
      { homeScore: 1, awayScore: 0, winner: 'Brazil', reasoning: 'Stronger.' },
      { home: 'Brazil', away: 'Argentina' }
    );
    expect(pick?.resultPick).toBe('home');

    const pick2 = ai.normalizeAiResponse(
      { homeScore: 0, awayScore: 1, winner: 'Argentina', reasoning: 'Solid defense.' },
      { home: 'Brazil', away: 'Argentina' }
    );
    expect(pick2?.resultPick).toBe('away');
  });

  it('should fall back to score-based result when winner is unrecognizable in parseWinnerPick (line 135)', () => {
    // homeScore=1 awayScore=0 → outcome = 'home'; unrecognized winner falls back to fromScore
    const pick = ai.normalizeAiResponse(
      { homeScore: 1, awayScore: 0, winner: 'Unknown Team', reasoning: 'x' },
      { home: 'Brazil', away: 'Argentina' }
    );
    // normalizeAiResponse uses fromScore ('home') as fallback when fromWinner is null
    expect(pick?.resultPick).toBe('home');
  });

  it('should return null from fetchMatchAiPrediction when Gemini returns invalid payload (lines 367-373)', async () => {
    // Gemini returns malformed JSON that normalizes to null
    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/sys_bad' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ homeScore: -1, awayScore: 0, winner: 'INVALID' }) }] }
          }]
        }
      });
    const fixture = {
      id: 999991, home: 'Brazil', away: 'Argentina',
      kickoff: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    };
    const result = await ai.fetchMatchAiPrediction({ game: 'worldcup', fixture });
    expect(result).toBeNull();
  });

  it('should fall back to default result cache TTL when kickoff is in the past', () => {
    const pastFixture = { kickoff: '2020-01-01T00:00:00Z' };
    const ttl = ai.getResultCacheTtlMs(pastFixture);
    // DEFAULT_RESULT_CACHE_MS is 6 hours (21600000ms)
    expect(ttl).toBe(6 * 60 * 60 * 1000);
  });

  it('should use remaining time as TTL when kickoff is in the future', () => {
    const futureDate = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const ttl = ai.getResultCacheTtlMs({ kickoff: futureDate });
    expect(ttl).toBeGreaterThan(60_000);
    expect(ttl).toBeLessThan(4 * 60 * 60 * 1000);
  });

  it('should use DEFAULT_RESULT_CACHE_MS when no kickoff is provided', () => {
    const ttl = ai.getResultCacheTtlMs({});
    expect(ttl).toBe(6 * 60 * 60 * 1000);
  });

  it('should build user prompt without competitionName or competitionCode', () => {
    const prompt = ai.buildUserPrompt({
      game: 'worldcup',
      fixture: { id: 1, home: 'Brazil', away: 'Argentina' }
    });
    expect(prompt).toContain('FIFA World Cup');
    expect(prompt).toContain('TBD');
  });

  it('should use fixed cache TTL when geminiPredictionCacheTtlMs is set', () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      predictionAiEnabled: true,
      geminiApiKey: 'test-key',
      geminiPredictionModel: 'gemini-3.1-flash-lite',
      geminiPredictionCacheTtlMs: 7200000, // 2 hours
      geminiContextCacheTtlSeconds: 3600
    }));
    const fixedAi = require('../../utils/matchPredictionAi');
    const ttl = fixedAi.getResultCacheTtlMs({ kickoff: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    expect(ttl).toBe(7200000);
  });

  it('should return cached prediction without calling Gemini on second call', async () => {
    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/sys_cached' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify({ homeScore: 3, awayScore: 1, winner: 'home', reasoning: 'Home form.' }) }]
            }
          }]
        }
      });

    const fixture = { id: 920001, home: 'Liverpool', away: 'Man City', kickoff: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() };
    const first = await ai.fetchMatchAiPrediction({ game: 'club', fixture });
    const second = await ai.fetchMatchAiPrediction({ game: 'club', fixture });

    expect(first?.homeScore).toBe(3);
    expect(second).toEqual(first);
    // Only 2 API calls (1 for context cache creation, 1 for Gemini generation)
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
  });

  it('should force refresh prediction when forceRefresh is true', async () => {
    mockAxios.post
      .mockResolvedValueOnce({ data: { name: 'cachedContents/sys_fr' } })
      .mockResolvedValueOnce({
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ homeScore: 0, awayScore: 0, winner: 'draw', reasoning: 'Even.' }) }] } }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify({ homeScore: 2, awayScore: 0, winner: 'home', reasoning: 'Home dominates.' }) }] } }]
        }
      });

    const fixture = { id: 930001, home: 'Barcelona', away: 'Madrid', kickoff: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() };
    await ai.fetchMatchAiPrediction({ game: 'club', fixture });
    const refreshed = await ai.fetchMatchAiPrediction({ game: 'club', fixture, forceRefresh: true });

    expect(refreshed?.homeScore).toBe(2);
  });
});
