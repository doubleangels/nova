const dayjs = require('dayjs');

/** Mock match ID used for the one-game instant demo flow. */
const MOCK_PLAYABLE_MATCH_IDS = [900001];

/** Stable kickoff for mock fixtures (set once at module load). */
const MOCK_KICKOFF_ISO = dayjs().add(2, 'hour').toISOString();

/**
 * Full-time score applied once at least one prediction exists for the fixture.
 * @type {Record<number, { home: number, away: number }>}
 */
const MOCK_SCRIPTED_FULL_TIME = {
  900001: { home: 2, away: 1 }
};

/**
 * Demo fixture uses real national teams and football-data.org area codes so country
 * flags match each side (same as production), not random mock flags.
 * @returns {Array<Record<string, unknown>>}
 */
function buildMockMatches() {
  return [
    {
      id: 900001,
      utcDate: MOCK_KICKOFF_ISO,
      status: 'TIMED',
      homeTeam: { name: 'Brazil', tla: 'BRA', area: { code: 'BRA' } },
      awayTeam: { name: 'Argentina', tla: 'ARG', area: { code: 'ARG' } },
      venue: 'Mock Stadium',
      stage: 'GROUP_STAGE',
      group: 'GROUP_A',
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
