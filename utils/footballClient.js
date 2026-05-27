const path = require('path');
const config = require('../config');
const axios = require('./httpClient');
const logger = require('../logger')(path.basename(__filename));
const { resolveIso2FromTeam } = require('./worldCupTeamFlags');
const { getCompetitionName } = require('./footballCompetitions');
const { getMockSeasonMatches, getMockMatchById } = require('./footballMockData');

const BASE_URL = 'https://api.football-data.org/v4';
const CACHE_TTL_MS = 5 * 60 * 1000;
const FIXTURE_ID_CHUNK_SIZE = 20;

/** @type {{ data: import('./footballUtils').NormalizedFixture[] | null, expiresAt: number }} */
let seasonCache = { data: null, expiresAt: 0 };

/** @type {Record<string, string>} football-data.org status → internal short code */
const STATUS_MAP = {
  SCHEDULED: 'NS',
  TIMED: 'NS',
  POSTPONED: 'PST',
  SUSPENDED: 'PST',
  FINISHED: 'FT',
  AWARDED: 'FT',
  IN_PLAY: 'LIVE',
  PAUSED: 'HT',
  CANCELLED: 'CANC'
};

/**
 * @param {string} status
 * @returns {string}
 */
function mapStatus(status) {
  if (!status) return 'NS';
  return STATUS_MAP[status] || status;
}

/**
 * @param {unknown} match
 * @param {string} [competitionCode]
 * @returns {import('./footballUtils').NormalizedFixture | null}
 */
function normalizeFixture(match, competitionCode) {
  if (!match || typeof match !== 'object') return null;

  const id = match.id;
  const home = match.homeTeam?.name;
  const away = match.awayTeam?.name;
  if (!id || !home || !away) return null;

  const fullTime = match.score?.fullTime;
  const code = match.competition?.code || competitionCode || null;

  return {
    id,
    home,
    away,
    homeIso2: resolveIso2FromTeam(match.homeTeam),
    awayIso2: resolveIso2FromTeam(match.awayTeam),
    homeTla: match.homeTeam?.tla || null,
    awayTla: match.awayTeam?.tla || null,
    competitionCode: code,
    competitionName: code ? getCompetitionName(code) : null,
    kickoff: match.utcDate,
    status: mapStatus(match.status),
    goals: {
      home: fullTime?.home ?? null,
      away: fullTime?.away ?? null
    }
  };
}

/**
 * @returns {boolean}
 */
function isMockApiEnabled() {
  return Boolean(config.predictionMockApi);
}

/**
 * @returns {Record<string, string>}
 */
function apiHeaders() {
  return { 'X-Auth-Token': config.footballDataApiKey };
}

/**
 * @returns {boolean}
 */
function isApiConfigured() {
  if (isMockApiEnabled()) return true;
  return Boolean(config.footballDataApiKey && String(config.footballDataApiKey).trim());
}

/**
 * Clears the in-memory season fixture cache (for tests).
 */
function clearSeasonCache() {
  seasonCache = { data: null, expiresAt: 0 };
}

/**
 * @param {string} competitionCode
 * @returns {Promise<import('./footballUtils').NormalizedFixture[]>}
 */
async function fetchCompetitionMatches(competitionCode) {
  const response = await axios.get(
    `${BASE_URL}/competitions/${competitionCode}/matches`,
    {
      headers: apiHeaders(),
      params: { season: config.footballSeason }
    }
  );

  const list = response.data?.matches;
  if (!Array.isArray(list)) {
    logger.warn('football-data.org returned unexpected matches payload.', {
      competitionCode,
      message: response.data?.message
    });
    return [];
  }

  return list
    .map(match => normalizeFixture(match, competitionCode))
    .filter(Boolean);
}

/**
 * @returns {Promise<import('./footballUtils').NormalizedFixture[]>}
 */
async function fetchSeasonMatchesFromApi() {
  if (!isApiConfigured()) {
    return [];
  }

  if (isMockApiEnabled()) {
    logger.debug('Returning simulated club football fixtures.');
    const fixtures = getMockSeasonMatches().map(normalizeFixture).filter(Boolean);
    const { applyMockInstantFinishToFixtures } = require('./footballUtils');
    return applyMockInstantFinishToFixtures(fixtures);
  }

  const codes = config.footballCompetitionCodes;
  const batches = await Promise.all(
    codes.map(code =>
      fetchCompetitionMatches(code).catch(err => {
        logger.error('Failed to fetch competition matches.', {
          err,
          competitionCode: code
        });
        return [];
      })
    )
  );

  const byId = new Map();
  for (const fixtures of batches) {
    for (const fixture of fixtures) {
      byId.set(fixture.id, fixture);
    }
  }

  return [...byId.values()].sort(
    (a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0)
  );
}

/**
 * @param {number} matchId
 * @returns {Promise<import('./footballUtils').NormalizedFixture | null>}
 */
async function fetchMatchByIdFromApi(matchId) {
  if (!isApiConfigured()) {
    return null;
  }

  if (isMockApiEnabled()) {
    const match = getMockMatchById(matchId);
    if (!match) return null;
    const fixture = normalizeFixture(match);
    if (!fixture) return null;
    const { applyMockInstantFinishToFixtures } = require('./footballUtils');
    const finished = await applyMockInstantFinishToFixtures([fixture]);
    return finished[0] ?? null;
  }

  try {
    const response = await axios.get(`${BASE_URL}/matches/${matchId}`, {
      headers: apiHeaders()
    });
    return normalizeFixture(response.data);
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * @param {{ status?: string, date?: string, competition?: string, forceRefresh?: boolean }} [options]
 * @returns {Promise<import('./footballUtils').NormalizedFixture[]>}
 */
async function getSeasonFixtures(options = {}) {
  const now = Date.now();
  const canUseCache =
    !isMockApiEnabled() &&
    !options.forceRefresh &&
    seasonCache.data &&
    seasonCache.expiresAt > now;

  let fixtures;
  if (canUseCache) {
    fixtures = seasonCache.data;
  } else {
    fixtures = await fetchSeasonMatchesFromApi();
    if (!isMockApiEnabled()) {
      seasonCache = {
        data: fixtures,
        expiresAt: now + CACHE_TTL_MS
      };
    }
  }

  if (options.status) {
    fixtures = fixtures.filter(f => f.status === options.status);
  }
  if (options.date) {
    fixtures = fixtures.filter(f => f.kickoff && f.kickoff.startsWith(options.date));
  }
  if (options.competition) {
    const code = String(options.competition).trim().toUpperCase();
    fixtures = fixtures.filter(f => f.competitionCode === code);
  }
  return fixtures;
}

/**
 * @param {number} fixtureId
 * @returns {Promise<import('./footballUtils').NormalizedFixture | null>}
 */
async function getFixtureById(fixtureId) {
  if (isMockApiEnabled()) {
    return fetchMatchByIdFromApi(fixtureId);
  }

  const cached = seasonCache.data?.find(f => f.id === fixtureId);
  if (cached) return cached;

  return fetchMatchByIdFromApi(fixtureId);
}

/**
 * @param {number[]} ids
 * @returns {Promise<import('./footballUtils').NormalizedFixture[]>}
 */
async function getFixturesByIds(ids) {
  if (!ids.length || !isApiConfigured()) return [];

  const uniqueIds = [...new Set(ids)];
  const results = [];

  for (let i = 0; i < uniqueIds.length; i += FIXTURE_ID_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + FIXTURE_ID_CHUNK_SIZE);
    const chunkFixtures = await Promise.all(
      chunk.map(id => fetchMatchByIdFromApi(id))
    );
    results.push(...chunkFixtures.filter(Boolean));
  }

  return results;
}

module.exports = {
  normalizeFixture,
  mapStatus,
  isMockApiEnabled,
  isApiConfigured,
  clearSeasonCache,
  fetchCompetitionMatches,
  getSeasonFixtures,
  getFixtureById,
  getFixturesByIds,
  CACHE_TTL_MS
};
