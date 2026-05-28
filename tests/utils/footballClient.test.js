describe('footballClient', () => {
  let client;
  let mockAxios;

  const sampleMatch = (overrides = {}) => ({
    id: 1,
    utcDate: '2026-01-01T15:00:00Z',
    status: 'TIMED',
    homeTeam: { name: 'Arsenal', tla: 'ARS' },
    awayTeam: { name: 'Chelsea', tla: 'CHE' },
    score: { fullTime: { home: null, away: null } },
    competition: { code: 'PL' },
    ...overrides
  });

  const mkErr = (status, headers = {}) => {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, headers };
    return err;
  };

  beforeEach(() => {
    jest.resetModules();
    mockAxios = { get: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key',
      footballSeason: '2025',
      footballCompetitionCodes: ['PL', 'BL1']
    }));
    jest.doMock('../../logger', () => () => ({
      debug: jest.fn(), warn: jest.fn(), error: jest.fn()
    }));
    client = require('../../utils/footballClient');
    client.clearSeasonCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should report API configured when key is set', () => {
    expect(client.isApiConfigured()).toBe(true);
  });

  it('should report API configured when mock mode is enabled without a key', () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      footballDataApiKey: '', predictionMockApi: true,
      footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const mockClient = require('../../utils/footballClient');
    expect(mockClient.isApiConfigured()).toBe(true);
    expect(mockClient.isMockApiEnabled()).toBe(true);
  });

  it('should return [] when not configured (line 281)', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({ footballDataApiKey: '', footballCompetitionCodes: ['PL'] }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const unconfigured = require('../../utils/footballClient');
    const fixtures = await unconfigured.getSeasonFixtures();
    expect(fixtures).toEqual([]);
  });

  it('should return mock fixtures without calling the API', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: '', predictionMockApi: true,
      footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const mockClient = require('../../utils/footballClient');
    const fixtures = await mockClient.getSeasonFixtures();
    expect(mockAxios.get).not.toHaveBeenCalled();
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].competitionCode).toBe('PL');
    expect(fixtures[0].homeIso2).toBe('GB');
    expect(fixtures[0].awayIso2).toBe('GB');
  });

  it('should merge fixtures from multiple competitions', async () => {
    mockAxios.get
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 1 })] } })
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 2, competition: { code: 'BL1' } })] } });

    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toHaveLength(2);
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });

  it('should retry an earlier season when the configured season returns 404', async () => {
    mockAxios.get
      .mockRejectedValueOnce(mkErr(404))
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 99 })] } });

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2026', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toHaveLength(1);
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
    expect(mockAxios.get.mock.calls[0][1].params).toEqual({ season: '2026' });
    expect(mockAxios.get.mock.calls[1][1].params).toEqual({ season: '2025' });
  });

  it('should fall back to API default season when all explicit seasons return 404 (lines 262-268)', async () => {
    mockAxios.get
      .mockRejectedValueOnce(mkErr(404))
      .mockRejectedValueOnce(mkErr(404))
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 55 })] } });

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].id).toBe(55);
    expect(mockAxios.get).toHaveBeenCalledTimes(3);
  });

  it('should return [] when all seasons including default return null (lines 270-273)', async () => {
    mockAxios.get
      .mockRejectedValueOnce(mkErr(404))
      .mockRejectedValueOnce(mkErr(404))
      .mockRejectedValueOnce(mkErr(404));

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toEqual([]);
  });

  it('should throttle rapid sequential API requests (lines 159-163)', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const prodClient = require('../../utils/footballClient');

    mockAxios.get.mockResolvedValue({ data: sampleMatch() });
    jest.useFakeTimers();
    const p1 = prodClient.getFixtureById(10);
    const p2 = prodClient.getFixtureById(11);
    await Promise.resolve();
    jest.advanceTimersByTime(10000);
    await Promise.all([p1, p2]);
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
    process.env.NODE_ENV = originalEnv;
  });

  it('should fallback to default rate limit retry if headers are missing (line 151)', async () => {
    jest.useFakeTimers();
    mockAxios.get.mockRejectedValueOnce(mkErr(429, {})); // no headers
    mockAxios.get.mockResolvedValueOnce({ data: sampleMatch() });
    const p = client.getFixtureById(123);
    await jest.runAllTimersAsync();
    await p;
  });

  it('should return null if rate limit retries are exhausted (lines 145-151, 189)', async () => {
    jest.useFakeTimers();
    mockAxios.get
      .mockRejectedValueOnce(mkErr(429, { 'retry-after': '1' }))
      .mockRejectedValueOnce(mkErr(429, { 'retry-after': '1' }))
      .mockRejectedValueOnce(mkErr(429, { 'retry-after': '1' }))
      .mockRejectedValueOnce(mkErr(429, { 'retry-after': '1' }));
    
    const p = client.getFixtureById(123).catch(e => e);
    await jest.runAllTimersAsync();
    const result = await p;
    expect(result.response?.status).toBe(429);
  });

  it('should return in-flight promise for concurrent requests (lines 376, 398)', async () => {
    mockAxios.get.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: { matches: [sampleMatch()] } }), 100)));
    const [f1, f2] = await Promise.all([
      client.getSeasonFixtures({ forceRefresh: true }),
      client.getSeasonFixtures({ forceRefresh: true })
    ]);
    expect(f1).toBe(f2);
  });

  it('should return null from getFixtureById if not configured (line 343)', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ footballDataApiKey: '' }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const unconfigured = require('../../utils/footballClient');
    expect(await unconfigured.getFixtureById(123)).toBeNull();
  });

  it('should fetch mock fixture by id (lines 347-352, 465)', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({ predictionMockApi: true, footballDataApiKey: '' }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const mockC = require('../../utils/footballClient');
    const f1 = await mockC.getFixtureById(910001);
    expect(f1.id).toBe(910001);
    const f2 = await mockC.getFixtureById(999);
    expect(f2).toBeNull();
  });

  it('should return stale cache when rate limited on refresh', async () => {
    jest.useFakeTimers();

    mockAxios.get.mockResolvedValueOnce({ data: { matches: [sampleMatch()] } });
    await client.getSeasonFixtures();

    mockAxios.get.mockRejectedValue(mkErr(429, { 'x-requestcounter-reset': '1' }));

    const refreshPromise = client.getSeasonFixtures({ forceRefresh: true });
    await jest.runAllTimersAsync();
    const fixtures = await refreshPromise;

    jest.useRealTimers();
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].id).toBe(1);
  });

  it('should throw when rate limited with no cached data (line 416)', async () => {
    // sawRateLimit path: rate limit error propagates directly when no cache exists
    mockAxios.get.mockRejectedValue(mkErr(429, { 'x-requestcounter-reset': '1' }));
    await expect(client.getSeasonFixtures()).rejects.toMatchObject({ response: { status: 429 } });
  });

  it('should handle non-array matches response with warning (lines 221-226)', async () => {
    mockAxios.get.mockResolvedValue({ data: { message: 'no matches found' } });

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toEqual([]);
  });

  it('should log error and push empty batch for non-429 competition errors', async () => {
    mockAxios.get
      .mockRejectedValueOnce(mkErr(500))
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 2, competition: { code: 'BL1' } })] } });

    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].id).toBe(2);
  });

  it('should log 429 warning and continue when one competition is rate-limited (lines 300-305)', async () => {
    // Override sleep to resolve immediately so withRateLimitRetry retries fast
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { fn(); return 0; };

    const rl429 = mkErr(429, { 'x-requestcounter-reset': '1' });
    mockAxios.get
      .mockRejectedValueOnce(rl429)  // PL attempt 1
      .mockRejectedValueOnce(rl429)  // PL attempt 2
      .mockRejectedValueOnce(rl429)  // PL attempt 3 (last → throws to comp loop)
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 2, competition: { code: 'BL1' } })] } })
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 3, competition: { code: 'BL1' } })] } });

    const fixtures = await client.getSeasonFixtures();
    global.setTimeout = origSetTimeout;
    // PL was rate-limited, BL1 succeeded → merged has BL1 fixture
    expect(fixtures.some(f => f.competitionCode === 'BL1')).toBe(true);
  });

  it('should return min 5 min when pollMs is set (line 121)', () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key',
      footballSeason: '2025',
      footballCompetitionCodes: ['PL'],
      predictionPollIntervalMs: 10 * 60 * 1000
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const c = require('../../utils/footballClient');
    expect(c.getCacheTtlMs()).toBe(10 * 60 * 1000);
  });

  it('should use cached fixture when not stale (getFixtureById line 469)', async () => {
    const futureKickoff = new Date(Date.now() + 3600000).toISOString();
    mockAxios.get
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 1, utcDate: futureKickoff })] } })
      .mockResolvedValueOnce({ data: { matches: [] } }); // BL1

    await client.getSeasonFixtures();
    const fixture = await client.getFixtureById(1);
    expect(fixture?.id).toBe(1);
    expect(mockAxios.get).toHaveBeenCalledTimes(2); // only the season call
  });

  it('should refetch stale fixture in cache (isCachedFixtureStale, lines 439-440)', async () => {
    const pastKickoff = '2020-01-01T15:00:00Z';
    mockAxios.get
      .mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 1, status: 'TIMED', utcDate: pastKickoff })] } })
      .mockResolvedValueOnce({ data: { matches: [] } }) // BL1
      .mockResolvedValueOnce({ data: sampleMatch({ id: 1, status: 'FINISHED', score: { fullTime: { home: 2, away: 1 } } }) });

    await client.getSeasonFixtures();
    const fixture = await client.getFixtureById(1);
    expect(fixture?.id).toBe(1);
    expect(mockAxios.get).toHaveBeenCalledTimes(3);
  });

  it('should return null from getFixtureById for 404 (lines 362-364)', async () => {
    mockAxios.get.mockRejectedValue(mkErr(404));
    const fixture = await client.getFixtureById(999);
    expect(fixture).toBeNull();
  });

  it('should rethrow non-404 error from getFixtureById', async () => {
    mockAxios.get.mockRejectedValue(mkErr(500));
    await expect(client.getFixtureById(999)).rejects.toMatchObject({ response: { status: 500 } });
  });

  it('should fetch fixtures by id via getFixturesByIds (lines 478-492)', async () => {
    mockAxios.get.mockResolvedValue({
      data: sampleMatch({ id: 5, status: 'FINISHED', score: { fullTime: { home: 1, away: 0 } } })
    });
    const fixtures = await client.getFixturesByIds([5]);
    expect(fixtures[0].id).toBe(5);
    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://api.football-data.org/v4/matches/5',
      expect.objectContaining({ headers: { 'X-Auth-Token': 'test-key' } })
    );
  });

  it('should return [] from getFixturesByIds when not configured (line 479)', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({ footballDataApiKey: '', footballCompetitionCodes: [] }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const unconfigured = require('../../utils/footballClient');
    expect(await unconfigured.getFixturesByIds([1])).toEqual([]);
  });

  it('should return [] from getFixturesByIds when ids array is empty', async () => {
    expect(await client.getFixturesByIds([])).toEqual([]);
  });

  it('should filter by competition code', async () => {
    mockAxios.get.mockResolvedValue({ data: { matches: [sampleMatch()] } });

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    const fixtures = await client.getSeasonFixtures({ competition: 'PL' });
    expect(fixtures.every(f => f.competitionCode === 'PL')).toBe(true);
  });

  it('should filter by status (line 422)', async () => {
    mockAxios.get.mockResolvedValue({
      data: {
        matches: [
          sampleMatch({ id: 1, status: 'FINISHED', score: { fullTime: { home: 2, away: 1 } } }),
          sampleMatch({ id: 2, status: 'TIMED' })
        ]
      }
    });

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    const ftFixtures = await client.getSeasonFixtures({ status: 'FT' });
    expect(ftFixtures).toHaveLength(1);
    expect(ftFixtures[0].id).toBe(1);
  });

  it('should filter by date (line 425)', async () => {
    mockAxios.get.mockResolvedValue({
      data: {
        matches: [
          sampleMatch({ id: 1, utcDate: '2026-02-01T15:00:00Z' }),
          sampleMatch({ id: 2, utcDate: '2026-03-01T15:00:00Z' })
        ]
      }
    });

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    const dateFixtures = await client.getSeasonFixtures({ date: '2026-02-01' });
    expect(dateFixtures).toHaveLength(1);
    expect(dateFixtures[0].id).toBe(1);
  });

  it('should use cached fixtures when available', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    mockAxios.get.mockResolvedValue({ data: { matches: [sampleMatch()] } });
    const first = await client.getSeasonFixtures();
    expect(mockAxios.get).toHaveBeenCalledTimes(1);

    // Call again, should use cache (mockAxios.get should not be called again)
    const second = await client.getSeasonFixtures();
    expect(second).toEqual(first);
    expect(mockAxios.get).toHaveBeenCalledTimes(1);
  });
  it('should return [] when not configured (whitespace key)', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({ footballDataApiKey: '   ', footballCompetitionCodes: ['PL'] }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const unconfigured = require('../../utils/footballClient');
    expect(unconfigured.isApiConfigured()).toBe(false);
  });

  it('should return true when configured with a non-empty string key', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({ footballDataApiKey: ' valid-key ', footballCompetitionCodes: ['PL'] }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const configured = require('../../utils/footballClient');
    expect(configured.isApiConfigured()).toBe(true);
  });

  it('should handle invalid footballSeason gracefully', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key',
      footballSeason: 'invalid-year',
      footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const tempClient = require('../../utils/footballClient');

    mockAxios.get.mockResolvedValueOnce({ data: { matches: [sampleMatch({ id: 1 })] } });
    const fixtures = await tempClient.getSeasonFixtures();
    expect(fixtures).toHaveLength(1);
  });

  it('should handle matches with missing kickoff and status during normalization and sorting', async () => {
    mockAxios.get.mockResolvedValue({
      data: sampleMatch({ id: 3, utcDate: undefined, status: null, competition: { code: null } })
    });
    const fixture = await client.getFixtureById(3);
    expect(fixture.status).toBe('NS');
    expect(fixture.competitionName).toBeNull();
  });

  it('should filter out invalid match objects during normalization', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        matches: [
          sampleMatch({ id: 2 }),
          null,
          'not-an-object'
        ]
      }
    });
    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toHaveLength(1);
  });

  it('should handle non-array matches response with warning (default season)', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { matches: null, message: 'Invalid explicit' } });
    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toEqual([]);
    
    mockAxios.get.mockResolvedValueOnce({ data: { matches: 'not an array', message: 'Invalid' } });
    const fixtures2 = await client.getSeasonFixtures();
    expect(fixtures2).toEqual([]);

    // 404 for explicit seasons (2025, 2024), then non-array for default season
    mockAxios.get
      .mockRejectedValueOnce(mkErr(404))
      .mockRejectedValueOnce(mkErr(404))
      .mockResolvedValueOnce({ data: { matches: null, message: 'Invalid default' } });
    const fixtures3 = await client.getSeasonFixtures();
    expect(fixtures3).toEqual([]);
  });

  it('should refetch stale fixture in cache', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key', footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    mockAxios.get.mockResolvedValueOnce({
      data: { matches: [sampleMatch({ id: 1, utcDate: '2000-01-01T00:00:00Z', status: 'NS' })] }
    });
    await client.getSeasonFixtures();

    mockAxios.get.mockResolvedValueOnce({ data: sampleMatch({ id: 1, status: 'FT', utcDate: '2000-01-01T00:00:00Z' }) });
    const fixture = await client.getFixtureById(1);
    expect(fixture.status).toBe('FT');
    
    mockAxios.get.mockResolvedValueOnce({ data: sampleMatch({ id: 1, status: 'FT', utcDate: '2000-01-01T00:00:00Z' }) });
    const cachedFixture = await client.getFixtureById(1);
    expect(cachedFixture.status).toBe('FT');
    expect(mockAxios.get).toHaveBeenCalledTimes(3);
  });

  it('should test missing kickoff in isCachedFixtureStale', async () => {
    // Fill cache
    mockAxios.get.mockResolvedValueOnce({
      data: { matches: [sampleMatch({ id: 1, utcDate: null, status: 'TIMED' })] }
    });
    await client.getSeasonFixtures();

    const cachedFixture = await client.getFixtureById(1);
    // isCachedFixtureStale will return false if !kickoff, so it uses cache!
    expect(cachedFixture.utcDate).toBeUndefined();
    // getSeasonFixtures calls it for each configured competition (PL, BL1) => 2 calls
    // getFixtureById uses cache and doesn't call API. Total: 2
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });

  it('should handle sorting of matches with missing kickoff', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        matches: [
          sampleMatch({ id: 1, utcDate: '2026-02-01T15:00:00Z' }),
          sampleMatch({ id: 2, utcDate: null }),
          sampleMatch({ id: 3, utcDate: undefined })
        ]
      }
    });
    const fixtures = await client.getSeasonFixtures();
    // 2 and 3 have missing kickoff, they get sorted properly
    expect(fixtures).toHaveLength(3);
    // Since missing kickoff uses Date(0), they will be first
    expect(fixtures[0].id).toBe(2);
    expect(fixtures[1].id).toBe(3);
    expect(fixtures[2].id).toBe(1);
  });

  it('should handle mock fetch with incomplete match or empty mock finish array', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      footballDataApiKey: '', predictionMockApi: true,
      footballSeason: '2025', footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../utils/footballMockData', () => ({
      getMockMatchById: jest.fn()
        .mockReturnValueOnce({ id: 100 }) 
        .mockReturnValueOnce({ id: 101, homeTeam: { name: 'A' }, awayTeam: { name: 'B' } })
    }));
    jest.doMock('../../utils/predictionMockFinish', () => ({
      applyMockInstantFinishToFixtures: jest.fn().mockResolvedValue([])
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const mockClient = require('../../utils/footballClient');

    let res = await mockClient.getFixtureById(100);
    expect(res).toBeNull();

    res = await mockClient.getFixtureById(101);
    expect(res).toBeNull();
  });

});
