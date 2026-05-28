describe('footballClient', () => {
  let client;
  let mockAxios;

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
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }));
    client = require('../../utils/footballClient');
    client.clearSeasonCache();
  });

  it('should report API configured when key is set', () => {
    expect(client.isApiConfigured()).toBe(true);
  });

  it('should report API configured when mock mode is enabled without a key', () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      footballDataApiKey: '',
      predictionMockApi: true,
      footballSeason: '2025',
      footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    const mockClient = require('../../utils/footballClient');
    expect(mockClient.isApiConfigured()).toBe(true);
    expect(mockClient.isMockApiEnabled()).toBe(true);
  });

  it('should return mock fixtures without calling the API', async () => {
    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: '',
      predictionMockApi: true,
      footballSeason: '2025',
      footballCompetitionCodes: ['PL']
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
      .mockResolvedValueOnce({
        data: {
          matches: [
            {
              id: 1,
              utcDate: '2026-01-01T15:00:00Z',
              status: 'TIMED',
              homeTeam: { name: 'A', tla: 'AAA' },
              awayTeam: { name: 'B', tla: 'BBB' },
              score: { fullTime: { home: null, away: null } },
              competition: { code: 'PL' }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          matches: [
            {
              id: 2,
              utcDate: '2026-01-02T15:00:00Z',
              status: 'TIMED',
              homeTeam: { name: 'C', tla: 'CCC' },
              awayTeam: { name: 'D', tla: 'DDD' },
              score: { fullTime: { home: null, away: null } },
              competition: { code: 'BL1' }
            }
          ]
        }
      });

    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toHaveLength(2);
    expect(fixtures[0].competitionCode).toBe('PL');
    expect(fixtures[1].competitionCode).toBe('BL1');
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });

  it('should retry an earlier season when the configured season returns 404', async () => {
    const axiosError = status => {
      const err = new Error(`Request failed with status code ${status}`);
      err.response = { status };
      return err;
    };

    mockAxios.get
      .mockRejectedValueOnce(axiosError(404))
      .mockResolvedValueOnce({
        data: {
          matches: [
            {
              id: 99,
              utcDate: '2026-01-01T15:00:00Z',
              status: 'TIMED',
              homeTeam: { name: 'A', tla: 'AAA' },
              awayTeam: { name: 'B', tla: 'BBB' },
              score: { fullTime: { home: null, away: null } },
              competition: { code: 'PL' }
            }
          ]
        }
      });

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key',
      footballSeason: '2026',
      footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }));
    client = require('../../utils/footballClient');

    const fixtures = await client.getSeasonFixtures();
    expect(fixtures).toHaveLength(1);
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
    expect(mockAxios.get.mock.calls[0][1].params).toEqual({ season: '2026' });
    expect(mockAxios.get.mock.calls[1][1].params).toEqual({ season: '2025' });
  });

  it('should return stale cache when rate limited on refresh', async () => {
    jest.useFakeTimers();

    mockAxios.get.mockResolvedValueOnce({
      data: {
        matches: [
          {
            id: 1,
            utcDate: '2026-01-01T15:00:00Z',
            status: 'TIMED',
            homeTeam: { name: 'A', tla: 'AAA' },
            awayTeam: { name: 'B', tla: 'BBB' },
            score: { fullTime: { home: null, away: null } },
            competition: { code: 'PL' }
          }
        ]
      }
    });

    await client.getSeasonFixtures();
    mockAxios.get.mockRejectedValue({
      response: { status: 429, headers: { 'x-requestcounter-reset': '1' } }
    });

    const refreshPromise = client.getSeasonFixtures({ forceRefresh: true });
    await jest.runAllTimersAsync();
    const fixtures = await refreshPromise;

    jest.useRealTimers();
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].id).toBe(1);
  });

  it('should filter by competition code', async () => {
    mockAxios.get.mockResolvedValue({
      data: {
        matches: [
          {
            id: 1,
            utcDate: '2026-01-01T15:00:00Z',
            status: 'TIMED',
            homeTeam: { name: 'A' },
            awayTeam: { name: 'B' },
            score: { fullTime: { home: null, away: null } },
            competition: { code: 'PL' }
          }
        ]
      }
    });

    jest.resetModules();
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-key',
      footballSeason: '2025',
      footballCompetitionCodes: ['PL']
    }));
    jest.doMock('../../logger', () => () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    client = require('../../utils/footballClient');

    const fixtures = await client.getSeasonFixtures({ competition: 'PL' });
    expect(fixtures.every(f => f.competitionCode === 'PL')).toBe(true);
  });
});
