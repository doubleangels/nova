const path = require('path');
const config = require('../config');
const axios = require('./httpClient');
const logger = require('../logger')(path.basename(__filename));

const BASE_URL = 'https://v3.football.api-sports.io';
const CACHE_TTL_MS = 5 * 60 * 1000;
const FIXTURE_ID_CHUNK_SIZE = 20;

/** @type {{ data: import('./worldCupUtils').NormalizedFixture[] | null, expiresAt: number }} */
let seasonCache = { data: null, expiresAt: 0 };

/**
 * @param {unknown} item
 * @returns {import('./worldCupUtils').NormalizedFixture | null}
 */
function normalizeFixture(item) {
  if (!item || typeof item !== 'object') return null;
  const fixture = item.fixture;
  const teams = item.teams;
  const goals = item.goals;
  if (!fixture?.id || !teams?.home?.name || !teams?.away?.name) return null;

  return {
    id: fixture.id,
    home: teams.home.name,
    away: teams.away.name,
    kickoff: fixture.date,
    status: fixture.status?.short || 'NS',
    goals: {
      home: goals?.home ?? null,
      away: goals?.away ?? null
    }
  };
}

/**
 * @returns {boolean}
 */
function isApiConfigured() {
  return Boolean(config.apiFootballKey && String(config.apiFootballKey).trim());
}

/**
 * Clears the in-memory season fixture cache (for tests).
 */
function clearSeasonCache() {
  seasonCache = { data: null, expiresAt: 0 };
}

/**
 * @param {Record<string, string | number | undefined>} params
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture[]>}
 */
async function fetchFixturesFromApi(params) {
  if (!isApiConfigured()) {
    return [];
  }

  const response = await axios.get(`${BASE_URL}/fixtures`, {
    headers: { 'x-apisports-key': config.apiFootballKey },
    params
  });

  const list = response.data?.response;
  if (!Array.isArray(list)) {
    logger.warn('API-Football returned unexpected fixtures payload.', {
      errors: response.data?.errors
    });
    return [];
  }

  return list.map(normalizeFixture).filter(Boolean);
}

/**
 * @param {{ status?: string, date?: string, forceRefresh?: boolean }} [options]
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture[]>}
 */
async function getSeasonFixtures(options = {}) {
  const now = Date.now();
  if (
    !options.forceRefresh &&
    seasonCache.data &&
    seasonCache.expiresAt > now
  ) {
    let fixtures = seasonCache.data;
    if (options.status) {
      fixtures = fixtures.filter(f => f.status === options.status);
    }
    if (options.date) {
      fixtures = fixtures.filter(f => f.kickoff && f.kickoff.startsWith(options.date));
    }
    return fixtures;
  }

  const fixtures = await fetchFixturesFromApi({
    league: config.worldCupLeagueId,
    season: config.worldCupSeason,
    timezone: 'UTC'
  });

  seasonCache = {
    data: fixtures,
    expiresAt: now + CACHE_TTL_MS
  };

  if (options.status) {
    return fixtures.filter(f => f.status === options.status);
  }
  if (options.date) {
    return fixtures.filter(f => f.kickoff && f.kickoff.startsWith(options.date));
  }
  return fixtures;
}

/**
 * @param {number} fixtureId
 * @returns {Promise<import('./worldCupUtils').NormalizedFixture | null>}
 */
async function getFixtureById(fixtureId) {
  const cached = seasonCache.data?.find(f => f.id === fixtureId);
  if (cached) return cached;

  const fixtures = await getFixturesByIds([fixtureId]);
  return fixtures[0] || null;
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
    const chunkFixtures = await fetchFixturesFromApi({
      ids: chunk.join('-')
    });
    results.push(...chunkFixtures);
  }

  return results;
}

module.exports = {
  normalizeFixture,
  isApiConfigured,
  clearSeasonCache,
  getSeasonFixtures,
  getFixtureById,
  getFixturesByIds,
  CACHE_TTL_MS
};
