describe('worldCupClient', () => {
  let client;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();
    mockAxios = { get: jest.fn() };
    jest.doMock('../../utils/httpClient', () => mockAxios);
    jest.doMock('../../config', () => ({
      apiFootballKey: 'test-api-key',
      worldCupLeagueId: '1',
      worldCupSeason: '2026'
    }));
    client = require('../../utils/worldCupClient');
    client.clearSeasonCache();
  });

  describe('normalizeFixture', () => {
    it('should normalize API fixture payload', () => {
      const normalized = client.normalizeFixture({
        fixture: { id: 100, date: '2026-06-01T12:00:00+00:00', status: { short: 'NS' } },
        teams: { home: { name: 'Team A' }, away: { name: 'Team B' } },
        goals: { home: null, away: null }
      });
      expect(normalized).toEqual({
        id: 100,
        home: 'Team A',
        away: 'Team B',
        kickoff: '2026-06-01T12:00:00+00:00',
        status: 'NS',
        goals: { home: null, away: null }
      });
    });

    it('should return null for invalid payload', () => {
      expect(client.normalizeFixture(null)).toBeNull();
      expect(client.normalizeFixture({})).toBeNull();
      expect(client.normalizeFixture({
        fixture: { id: 1 },
        teams: { home: { name: 'A' } },
        goals: {}
      })).toBeNull();
      expect(client.normalizeFixture({
        fixture: { id: 2, date: '2026-06-01T12:00:00+00:00', status: {} },
        teams: { home: { name: 'A' }, away: { name: 'B' } },
        goals: { home: null, away: null }
      }).status).toBe('NS');
    });
  });

  describe('getSeasonFixtures', () => {
    it('should fetch and cache fixtures', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          response: [{
            fixture: { id: 1, date: '2026-06-01T12:00:00+00:00', status: { short: 'NS' } },
            teams: { home: { name: 'A' }, away: { name: 'B' } },
            goals: { home: null, away: null }
          }]
        }
      });

      const first = await client.getSeasonFixtures();
      const second = await client.getSeasonFixtures();

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://v3.football.api-sports.io/fixtures',
        expect.objectContaining({
          headers: { 'x-apisports-key': 'test-api-key' },
          params: expect.objectContaining({ league: '1', season: '2026' })
        })
      );
    });

    it('should filter by status from cache', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          response: [
            {
              fixture: { id: 1, date: '2026-06-01T12:00:00+00:00', status: { short: 'NS' } },
              teams: { home: { name: 'A' }, away: { name: 'B' } },
              goals: { home: null, away: null }
            },
            {
              fixture: { id: 2, date: '2026-06-01T14:00:00+00:00', status: { short: 'FT' } },
              teams: { home: { name: 'C' }, away: { name: 'D' } },
              goals: { home: 1, away: 0 }
            }
          ]
        }
      });

      await client.getSeasonFixtures();
      const nsOnly = await client.getSeasonFixtures({ status: 'NS' });
      expect(nsOnly).toHaveLength(1);
      expect(nsOnly[0].status).toBe('NS');
    });

    it('should handle non-array API response', async () => {
      mockAxios.get.mockResolvedValue({ data: { response: null, errors: ['rate'] } });
      client.clearSeasonCache();
      const fixtures = await client.getSeasonFixtures({ forceRefresh: true });
      expect(fixtures).toEqual([]);
    });

    it('should filter by status after force refresh', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          response: [
            {
              fixture: { id: 1, date: '2026-06-01T12:00:00+00:00', status: { short: 'NS' } },
              teams: { home: { name: 'A' }, away: { name: 'B' } },
              goals: { home: null, away: null }
            },
            {
              fixture: { id: 2, date: '2026-06-02T12:00:00+00:00', status: { short: 'FT' } },
              teams: { home: { name: 'C' }, away: { name: 'D' } },
              goals: { home: 1, away: 0 }
            }
          ]
        }
      });
      const ft = await client.getSeasonFixtures({ forceRefresh: true, status: 'FT' });
      expect(ft.every(f => f.status === 'FT')).toBe(true);
    });

    it('should filter by date after force refresh', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          response: [{
            fixture: { id: 1, date: '2026-06-01T12:00:00+00:00', status: { short: 'NS' } },
            teams: { home: { name: 'A' }, away: { name: 'B' } },
            goals: { home: null, away: null }
          }]
        }
      });
      const fixtures = await client.getSeasonFixtures({
        forceRefresh: true,
        date: '2026-06-01'
      });
      expect(fixtures).toHaveLength(1);
    });

    it('should filter by date from cache', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          response: [{
            fixture: { id: 1, date: '2026-06-01T12:00:00+00:00', status: { short: 'NS' } },
            teams: { home: { name: 'A' }, away: { name: 'B' } },
            goals: { home: null, away: null }
          }]
        }
      });
      await client.getSeasonFixtures();
      const filtered = await client.getSeasonFixtures({ date: '2026-06-01' });
      expect(filtered).toHaveLength(1);
    });

    it('should return null when fixture id not found via API', async () => {
      mockAxios.get.mockResolvedValue({ data: { response: [] } });
      const fixture = await client.getFixtureById(404);
      expect(fixture).toBeNull();
    });

    it('should fetch fixture by id when not cached', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          response: [{
            fixture: { id: 99, date: '2026-06-01T12:00:00+00:00', status: { short: 'NS' } },
            teams: { home: { name: 'A' }, away: { name: 'B' } },
            goals: { home: null, away: null }
          }]
        }
      });
      const fixture = await client.getFixtureById(99);
      expect(fixture.id).toBe(99);
    });

    it('should return empty for empty id list', async () => {
      expect(await client.getFixturesByIds([])).toEqual([]);
    });

    it('should get fixture by id from cache', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          response: [{
            fixture: { id: 9, date: '2026-06-01T12:00:00+00:00', status: { short: 'NS' } },
            teams: { home: { name: 'A' }, away: { name: 'B' } },
            goals: { home: null, away: null }
          }]
        }
      });
      await client.getSeasonFixtures();
      const fixture = await client.getFixtureById(9);
      expect(fixture.id).toBe(9);
    });

    it('should return empty when API key missing', async () => {
      jest.resetModules();
      jest.doMock('../../config', () => ({ apiFootballKey: '' }));
      jest.doMock('../../utils/httpClient', () => mockAxios);
      const noKeyClient = require('../../utils/worldCupClient');
      const fixtures = await noKeyClient.getSeasonFixtures();
      expect(fixtures).toEqual([]);
      expect(mockAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('getFixturesByIds', () => {
    it('should batch fixture ids', async () => {
      mockAxios.get.mockResolvedValue({
        data: {
          response: [{
            fixture: { id: 5, date: '2026-06-01T12:00:00+00:00', status: { short: 'FT' } },
            teams: { home: { name: 'A' }, away: { name: 'B' } },
            goals: { home: 1, away: 0 }
          }]
        }
      });

      const fixtures = await client.getFixturesByIds([5]);
      expect(fixtures[0].id).toBe(5);
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://v3.football.api-sports.io/fixtures',
        expect.objectContaining({ params: { ids: '5' } })
      );
    });
  });
});
