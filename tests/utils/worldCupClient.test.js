describe('worldCupClient', () => {
  let client;
  let mockAxios;

  const sampleMatch = (overrides = {}) => ({
    id: 100,
    utcDate: '2026-06-01T12:00:00Z',
    status: 'SCHEDULED',
    homeTeam: { name: 'Team A' },
    awayTeam: { name: 'Team B' },
    score: { fullTime: { home: null, away: null } },
    ...overrides
  });

  beforeEach(() => {
    jest.resetModules();
    mockAxios = { get: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      footballDataApiKey: 'test-api-key',
      worldCupCompetitionCode: 'WC',
      worldCupSeason: '2026'
    }));
    client = require('../../utils/worldCupClient');
    client.clearSeasonCache();
  });

  describe('normalizeFixture', () => {
    it('should normalize football-data.org match payload', () => {
      const normalized = client.normalizeFixture(sampleMatch());
      expect(normalized).toEqual({
        id: 100,
        home: 'Team A',
        away: 'Team B',
        homeIso2: null,
        awayIso2: null,
        homeTla: null,
        awayTla: null,
        kickoff: '2026-06-01T12:00:00Z',
        status: 'NS',
        goals: { home: null, away: null }
      });
    });

    it('should resolve country codes from team payload', () => {
      const normalized = client.normalizeFixture(
        sampleMatch({
          homeTeam: { name: 'Brazil', tla: 'BRA' },
          awayTeam: { name: 'Argentina', tla: 'ARG' }
        })
      );
      expect(normalized.homeIso2).toBe('BR');
      expect(normalized.awayIso2).toBe('AR');
      expect(normalized.homeTla).toBe('BRA');
      expect(normalized.awayTla).toBe('ARG');
    });

    it('should map FINISHED status to FT', () => {
      const normalized = client.normalizeFixture(
        sampleMatch({
          status: 'FINISHED',
          score: { fullTime: { home: 2, away: 1 } }
        })
      );
      expect(normalized.status).toBe('FT');
      expect(normalized.goals).toEqual({ home: 2, away: 1 });
    });

    it('should return null for invalid payload', () => {
      expect(client.normalizeFixture(null)).toBeNull();
      expect(client.normalizeFixture({})).toBeNull();
      expect(client.normalizeFixture({
        id: 1,
        homeTeam: { name: 'A' },
        score: {}
      })).toBeNull();
      expect(client.normalizeFixture({
        id: 2,
        utcDate: '2026-06-01T12:00:00Z',
        homeTeam: { name: 'A' },
        awayTeam: { name: 'B' },
        score: { fullTime: { home: null, away: null } }
      }).status).toBe('NS');
    });
  });

  describe('getSeasonFixtures', () => {
    it('should fetch and cache fixtures', async () => {
      mockAxios.get.mockResolvedValue({
        data: { matches: [sampleMatch({ id: 1 })] }
      });

      const first = await client.getSeasonFixtures();
      const second = await client.getSeasonFixtures();

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://api.football-data.org/v4/competitions/WC/matches',
        expect.objectContaining({
          headers: { 'X-Auth-Token': 'test-api-key' },
          params: { season: '2026' }
        })
      );
    });

    it('should filter by status from cache', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          matches: [
            sampleMatch({ id: 1, status: 'SCHEDULED' }),
            sampleMatch({
              id: 2,
              utcDate: '2026-06-01T14:00:00Z',
              status: 'FINISHED',
              score: { fullTime: { home: 1, away: 0 } }
            })
          ]
        }
      });

      await client.getSeasonFixtures();
      const nsOnly = await client.getSeasonFixtures({ status: 'NS' });
      expect(nsOnly).toHaveLength(1);
      expect(nsOnly[0].status).toBe('NS');
    });

    it('should handle non-array API response', async () => {
      mockAxios.get.mockResolvedValue({ data: { matches: null, message: 'rate limit' } });
      client.clearSeasonCache();
      const fixtures = await client.getSeasonFixtures({ forceRefresh: true });
      expect(fixtures).toEqual([]);
    });

    it('should filter by status after force refresh', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          matches: [
            sampleMatch({ id: 1, status: 'SCHEDULED' }),
            sampleMatch({
              id: 2,
              utcDate: '2026-06-02T12:00:00Z',
              status: 'FINISHED',
              score: { fullTime: { home: 1, away: 0 } }
            })
          ]
        }
      });
      const ft = await client.getSeasonFixtures({ forceRefresh: true, status: 'FT' });
      expect(ft.every(f => f.status === 'FT')).toBe(true);
    });

    it('should filter by date after force refresh', async () => {
      mockAxios.get.mockResolvedValue({
        data: { matches: [sampleMatch({ id: 1 })] }
      });
      const fixtures = await client.getSeasonFixtures({
        forceRefresh: true,
        date: '2026-06-01'
      });
      expect(fixtures).toHaveLength(1);
    });

    it('should filter by date from cache', async () => {
      mockAxios.get.mockResolvedValue({
        data: { matches: [sampleMatch({ id: 1 })] }
      });
      await client.getSeasonFixtures();
      const filtered = await client.getSeasonFixtures({ date: '2026-06-01' });
      expect(filtered).toHaveLength(1);
    });

    it('should return null when fixture id not found via API', async () => {
      const err = new Error('not found');
      err.response = { status: 404 };
      mockAxios.get.mockRejectedValue(err);
      const fixture = await client.getFixtureById(404);
      expect(fixture).toBeNull();
    });

    it('should fetch fixture by id when not cached', async () => {
      mockAxios.get.mockResolvedValue({
        data: sampleMatch({ id: 99 })
      });
      const fixture = await client.getFixtureById(99);
      expect(fixture.id).toBe(99);
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://api.football-data.org/v4/matches/99',
        expect.objectContaining({
          headers: { 'X-Auth-Token': 'test-api-key' }
        })
      );
    });

    it('should return empty for empty id list', async () => {
      expect(await client.getFixturesByIds([])).toEqual([]);
    });

    it('should get fixture by id from cache', async () => {
      mockAxios.get.mockResolvedValue({
        data: { matches: [sampleMatch({ id: 9 })] }
      });
      await client.getSeasonFixtures();
      const fixture = await client.getFixtureById(9);
      expect(fixture.id).toBe(9);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should return empty when API key missing', async () => {
      jest.resetModules();
      jest.doMock('../../config', () => ({ footballDataApiKey: '' }));
      jest.doMock('../../utils/httpClient', () => mockAxios);
      const noKeyClient = require('../../utils/worldCupClient');
      const fixtures = await noKeyClient.getSeasonFixtures();
      expect(fixtures).toEqual([]);
      expect(mockAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('mock API mode', () => {
    beforeEach(() => {
      jest.resetModules();
      mockAxios = { get: jest.fn() };
      jest.doMock('../../utils/httpClient', () => mockAxios);
      jest.doMock('../../config', () => ({
        footballDataApiKey: '',
        predictionMockApi: true,
        worldCupCompetitionCode: 'WC',
        worldCupSeason: '2026'
      }));
      // Prevent applyMockFinish from consulting the real SQLite store (which may
      // have predictions from other test suites), so fixtures always appear as-is.
      jest.doMock('../../utils/predictionMockFinish', () => ({
        applyMockInstantFinishToFixtures: (_store, _ids, _data, fixtures) =>
          Promise.resolve(fixtures)
      }));
      client = require('../../utils/worldCupClient');
      client.clearSeasonCache();
    });

    it('should be configured without an API key', () => {
      expect(client.isMockApiEnabled()).toBe(true);
      expect(client.isApiConfigured()).toBe(true);
    });

    it('should return simulated season fixtures without HTTP calls', async () => {
      const fixtures = await client.getSeasonFixtures();
      expect(fixtures.length).toBeGreaterThan(0);
      expect(fixtures[0].id).toBe(900001);
      expect(mockAxios.get).not.toHaveBeenCalled();
    });

    it('should fetch mock fixture by id as upcoming before any predictions', async () => {
      const fixture = await client.getFixtureById(900001);
      expect(fixture?.home).toBe('Brazil');
      expect(fixture?.homeIso2).toBe('BR');
      expect(fixture?.awayIso2).toBe('AR');
      expect(fixture?.status).toBe('NS');
      expect(fixture?.goals).toEqual({ home: null, away: null });
      expect(mockAxios.get).not.toHaveBeenCalled();
    });

    it('should not cache simulated season fixtures', async () => {
      const first = await client.getSeasonFixtures();
      const second = await client.getSeasonFixtures();
      expect(mockAxios.get).not.toHaveBeenCalled();
      expect(first).toHaveLength(second.length);
    });
  });

  describe('getFixturesByIds', () => {
    it('should fetch fixtures by id individually', async () => {
      mockAxios.get.mockResolvedValue({
        data: sampleMatch({
          id: 5,
          status: 'FINISHED',
          score: { fullTime: { home: 1, away: 0 } }
        })
      });

      const fixtures = await client.getFixturesByIds([5]);
      expect(fixtures[0].id).toBe(5);
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://api.football-data.org/v4/matches/5',
        expect.objectContaining({
          headers: { 'X-Auth-Token': 'test-api-key' }
        })
      );
    });
  });
});
