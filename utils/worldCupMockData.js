const dayjs = require('dayjs');

/**
 * football-data.org-shaped match payloads with kickoffs relative to now.
 * IDs 900001–900005 are reserved for mock fixtures.
 * @returns {Array<Record<string, unknown>>}
 */
function buildMockMatches() {
  const now = dayjs();

  return [
    {
      id: 900001,
      utcDate: now.add(6, 'hour').toISOString(),
      status: 'TIMED',
      homeTeam: { name: 'Mockville United' },
      awayTeam: { name: 'Testistan' },
      score: { fullTime: { home: null, away: null } }
    },
    {
      id: 900002,
      utcDate: now.subtract(3, 'hour').toISOString(),
      status: 'FINISHED',
      homeTeam: { name: 'Sampleland' },
      awayTeam: { name: 'Demovakia' },
      score: { fullTime: { home: 2, away: 1 } }
    },
    {
      id: 900003,
      utcDate: now.subtract(45, 'minute').toISOString(),
      status: 'IN_PLAY',
      homeTeam: { name: 'Fixture FC' },
      awayTeam: { name: 'Preview City' },
      score: { fullTime: { home: 1, away: 1 } }
    },
    {
      id: 900004,
      utcDate: now.add(5, 'day').toISOString(),
      status: 'SCHEDULED',
      homeTeam: { name: 'Future Rovers' },
      awayTeam: { name: 'Later Athletic' },
      score: { fullTime: { home: null, away: null } }
    },
    {
      id: 900005,
      utcDate: now.add(2, 'day').toISOString(),
      status: 'POSTPONED',
      homeTeam: { name: 'Delayed Wanderers' },
      awayTeam: { name: 'Reschedule United' },
      score: { fullTime: { home: null, away: null } }
    }
  ];
}

/**
 * @returns {Array<Record<string, unknown>>}
 */
function getMockSeasonMatches() {
  return buildMockMatches();
}

/**
 * @param {number} matchId
 * @returns {Record<string, unknown>|null}
 */
function getMockMatchById(matchId) {
  return buildMockMatches().find(m => m.id === matchId) || null;
}

module.exports = {
  buildMockMatches,
  getMockSeasonMatches,
  getMockMatchById
};
