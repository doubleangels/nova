const path = require('path');
const config = require('../config');
const axios = require('./httpClient');
const logger = require('../logger')(path.basename(__filename));
const { getMockSeasonMatches, getMockMatchById } = require('./worldCupMockData');
const { resolveIso2FromTeam } = require('./worldCupTeamFlags');

const BASE_URL = 'https://api.football-data.org/v4';
const CACHE_TTL_MS = 5 * 60 * 1000;
const FIXTURE_ID_CHUNK_SIZE = 20;

/** @type {{ data: import('./worldCupUtils').NormalizedFixture[] | null, expiresAt: number }} */
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
 * @returns {boolean}
 */
function isMockApiEnabled() {
  return Boolean(config.predictionMockApi);
}

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
 * @returns {import('./worldCupUtils').NormalizedFixture | null}
 */
function normalizeFixture(match) {
  if (!match || typeof match !== 'object') return null;

  const id = match.id;
  const home = match.homeTeam?.name;
  const away = match.awayTeam?.name;
  if (!id || !home || !away) return null;

  const fullTime = match.score?.fullTime;

  return {
    id,
    home,
    away,
    homeIso2: resolveIso2FromTeam(match.homeTeam),
    awayIso2: resolveIso2FromTeam(match.awayTeam),
    homeTla: match.homeTeam?.tla || null,
    awayTla: match.awayTeam?.tla || null,
    kickoff: match.utcDate,
    status: mapStatus(match.status),
    goals: {
      home: fullTime?.home ?? null,
      away: fullTime?.away ?? null
    }
  };
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
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture[]>}
 */
async function fetchSeasonMatchesFromApi() {
  if (!isApiConfigured()) {
    return [];
  }

  if (isMockApiEnabled()) {
    logger.debug('Returning simulated World Cup season fixtures.');
    const fixtures = getMockSeasonMatches().map(normalizeFixture).filter(Boolean);
    return applyMockFinish(fixtures);
  }

  const response = await axios.get(
    `${BASE_URL}/competitions/${config.worldCupCompetitionCode}/matches`,
    {
      headers: apiHeaders(),
      params: { season: config.worldCupSeason }
    }
  );

  const list = response.data?.matches;
  if (!Array.isArray(list)) {
    logger.warn('football-data.org returned unexpected matches payload.', {
      message: response.data?.message
    });
    return [];
  }

  return list.map(normalizeFixture).filter(Boolean);
}

/**
 * @param {number} matchId
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture | null>}
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
    const finished = await applyMockFinish([fixture]);
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
 * @param {{ status?: string, date?: string, forceRefresh?: boolean }} [options]
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture[]>}
 */
async function getSeasonFixtures(options = {}) {
  const now = Date.now();
  const canUseCache =
    !isMockApiEnabled() &&
    !options.forceRefresh &&
    seasonCache.data &&
    seasonCache.expiresAt > now;

  if (canUseCache) {
    let fixtures = seasonCache.data;
    if (options.status) {
      fixtures = fixtures.filter(f => f.status === options.status);
    }
    if (options.date) {
      fixtures = fixtures.filter(f => f.kickoff && f.kickoff.startsWith(options.date));
    }
    return fixtures;
  }

  const fixtures = await fetchSeasonMatchesFromApi();

  if (!isMockApiEnabled()) {
    seasonCache = {
      data: fixtures,
      expiresAt: now + CACHE_TTL_MS
    };
  }

  if (options.status) {
    return fixtures.filter(f => f.status === options.status);
  }
  if (options.date) {
    return fixtures.filter(f => f.kickoff && f.kickoff.startsWith(options.date));
  }
  return fixtures;
}

/**
 * @param {{ kickoff?: string, status: string }} fixture
 * @returns {boolean}
 */
function isCachedFixtureStale(fixture) {
  if (!fixture.kickoff || fixture.status === 'FT') return false;
  return new Date(fixture.kickoff).getTime() <= Date.now();
}

/**
 * @param {import('./worldCupUtils').NormalizedFixture[]} fixtures
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture[]>}
 */
async function applyMockFinish(fixtures) {
  const { applyMockInstantFinishToFixtures } = require('./predictionMockFinish');
  const mockData = require('./worldCupMockData');
  const { store } = require('./worldCupUtils');
  return applyMockInstantFinishToFixtures(
    store,
    mockData.MOCK_PLAYABLE_MATCH_IDS,
    mockData,
    fixtures
  );
}

/**
 * @param {number} fixtureId
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture | null>}
 */
async function getFixtureById(fixtureId) {
  if (isMockApiEnabled()) {
    return fetchMatchByIdFromApi(fixtureId);
  }

  const cached = seasonCache.data?.find(f => f.id === fixtureId);
  if (cached && !isCachedFixtureStale(cached)) return cached;

  return fetchMatchByIdFromApi(fixtureId);
}

/**
 * @param {number[]} ids
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture[]>}
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
  getSeasonFixtures,
  getFixtureById,
  getFixturesByIds,
  CACHE_TTL_MS
};
