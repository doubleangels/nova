const dayjs = require('dayjs');

/** Mock match ID for the club-football one-game demo (distinct from World Cup 900xxx). */
const MOCK_PLAYABLE_MATCH_IDS = [910001];

/** Kickoff for mock fixtures (refreshed on each build). */
function getMockKickoffIso() {
  return dayjs().add(2, 'hour').toISOString();
}

/**
 * Full-time score applied once at least one prediction exists for the fixture.
 * @type {Record<number, { home: number, away: number }>}
 */
const MOCK_SCRIPTED_FULL_TIME = {
  910001: { home: 2, away: 1 }
};

/**
 * Demo fixture uses real club names and football-data.org area codes so country flags
 * match each side (same as production), not random mock flags.
 * @returns {Array<Record<string, unknown>>}
 */
function buildMockMatches() {
  return [
    {
      id: 910001,
      utcDate: getMockKickoffIso(),
      status: 'TIMED',
      competition: { code: 'PL', name: 'Premier League' },
      homeTeam: { name: 'Arsenal', tla: 'ARS', area: { code: 'ENG' } },
      awayTeam: { name: 'Chelsea', tla: 'CHE', area: { code: 'ENG' } },
      score: { fullTime: { home: null, away: null } }
    }
  ];
}

/**
 * @param {number} matchId
 * @returns {boolean}
 */
function isMockPlayableMatchId(matchId) {
  return MOCK_PLAYABLE_MATCH_IDS.includes(matchId);
}

/**
 * @param {number} matchId
 * @returns {{ home: number, away: number }|null}
 */
function getMockScriptedFullTimeGoals(matchId) {
  return MOCK_SCRIPTED_FULL_TIME[matchId] ?? null;
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
  MOCK_PLAYABLE_MATCH_IDS,
  MOCK_SCRIPTED_FULL_TIME,
  buildMockMatches,
  isMockPlayableMatchId,
  getMockScriptedFullTimeGoals,
  getMockSeasonMatches,
  getMockMatchById
};
