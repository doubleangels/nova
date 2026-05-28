const path = require('path');
const config = require('../config');
const axios = require('./httpClient');
const logger = require('../logger')(path.basename(__filename));
const { resolveClubIso2FromTeam } = require('./clubTeamFlags');
const { getCompetitionName } = require('./footballCompetitions');
const {
  getDefaultFootballSeasonYear,
  getFootballSeasonCandidates
} = require('./footballSeason');
const { getMockSeasonMatches, getMockMatchById } = require('./footballMockData');

const BASE_URL = 'https://api.football-data.org/v4';
const FIXTURE_ID_CHUNK_SIZE = 20;
/** Free tier is ~10 requests/minute; space competition calls apart. */
const MIN_REQUEST_GAP_MS =
  process.env.NODE_ENV === 'test' ? 0 : 6_500;
const RATE_LIMIT_MAX_RETRIES = 3;

/** @type {{ data: import('./footballUtils').NormalizedFixture[] | null, expiresAt: number }} */
let seasonCache = { data: null, expiresAt: 0 };
/** @type {Promise<import('./footballUtils').NormalizedFixture[]>|null} */
let seasonFetchInFlight = null;
/** @type {number} */
let lastApiRequestAt = 0;

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
    homeIso2: resolveClubIso2FromTeam(match.homeTeam, code),
    awayIso2: resolveClubIso2FromTeam(match.awayTeam, code),
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
  seasonFetchInFlight = null;
  lastApiRequestAt = 0;
}

/**
 * @returns {number}
 */
function getCacheTtlMs() {
  const pollMs = config.predictionPollIntervalMs;
  if (Number.isFinite(pollMs) && pollMs > 0) {
    return Math.max(pollMs, 5 * 60 * 1000);
  }
  return 15 * 60 * 1000;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {import('axios').AxiosResponse|undefined} response
 * @returns {number}
 */
function rateLimitWaitMs(response) {
  const resetHeader = response?.headers?.['x-requestcounter-reset'];
  const resetSeconds = parseInt(String(resetHeader ?? ''), 10);
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    return resetSeconds * 1000 + 500;
  }

  const retryAfter = response?.headers?.['retry-after'];
  const retrySeconds = parseInt(String(retryAfter ?? ''), 10);
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return retrySeconds * 1000 + 500;
  }

  return 60_000;
}

/**
 * @returns {Promise<void>}
 */
async function throttleBeforeApiRequest() {
  if (MIN_REQUEST_GAP_MS <= 0) return;
  const elapsed = Date.now() - lastApiRequestAt;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await sleep(MIN_REQUEST_GAP_MS - elapsed);
  }
  lastApiRequestAt = Date.now();
}

/**
 * @param {() => Promise<import('./footballUtils').NormalizedFixture[]|null>} request
 * @param {{ competitionCode?: string }} [context]
 * @returns {Promise<import('./footballUtils').NormalizedFixture[]|null>}
 */
async function withRateLimitRetry(request, context) {
  for (let attempt = 0; attempt < RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      await throttleBeforeApiRequest();
      return await request();
    } catch (err) {
      if (err.response?.status !== 429 || attempt >= RATE_LIMIT_MAX_RETRIES - 1) {
        throw err;
      }
      const waitMs = rateLimitWaitMs(err.response);
      logger.warn('football-data.org rate limit; retrying.', {
        ...context,
        attempt: attempt + 1,
        waitMs
      });
      await sleep(waitMs);
    }
  }
}

/**
 * @returns {number}
 */
function resolveConfiguredFootballSeason() {
  const parsed = parseInt(String(config.footballSeason), 10);
  return Number.isFinite(parsed) ? parsed : getDefaultFootballSeasonYear();
}

/**
 * @param {string} competitionCode
 * @param {number | undefined} season - Starting year, or omit for API default season
 * @returns {Promise<import('./footballUtils').NormalizedFixture[] | null>} null on 404
 */
async function fetchCompetitionMatchesForSeason(competitionCode, season) {
  const params =
    season != null ? { season: String(season) } : undefined;

  return withRateLimitRetry(async () => {
    try {
      const response = await axios.get(
        `${BASE_URL}/competitions/${competitionCode}/matches`,
        {
          headers: apiHeaders(),
          ...(params ? { params } : {})
        }
      );

      const list = response.data?.matches;
      if (!Array.isArray(list)) {
        logger.warn('football-data.org returned unexpected matches payload.', {
          competitionCode,
          season: season ?? 'default',
          message: response.data?.message
        });
        return [];
      }

      return list
        .map(match => normalizeFixture(match, competitionCode))
        .filter(Boolean);
    } catch (err) {
      if (err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  }, { competitionCode, season: season ?? 'default' });
}

/**
 * @param {string} competitionCode
 * @returns {Promise<import('./footballUtils').NormalizedFixture[]>}
 */
async function fetchCompetitionMatches(competitionCode) {
  const seasons = getFootballSeasonCandidates(resolveConfiguredFootballSeason());

  for (const season of seasons) {
    const fixtures = await fetchCompetitionMatchesForSeason(
      competitionCode,
      season
    );
    if (fixtures !== null) {
      return fixtures;
    }
    logger.warn('No matches for competition season.', {
      competitionCode,
      season
    });
  }

  const defaultSeasonFixtures = await fetchCompetitionMatchesForSeason(
    competitionCode,
    undefined
  );
  if (defaultSeasonFixtures !== null) {
    return defaultSeasonFixtures;
  }

  logger.warn('No matches for competition (API default season).', {
    competitionCode
  });
  return [];
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
    return applyMockFinish(fixtures);
  }

  const codes = config.footballCompetitionCodes;
  /** @type {import('./footballUtils').NormalizedFixture[][]} */
  const batches = [];
  let sawRateLimit = false;

  for (const code of codes) {
    try {
      const fixtures = await fetchCompetitionMatches(code);
      batches.push(fixtures);
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        sawRateLimit = true;
        logger.warn('Skipping competition after rate limit.', {
          competitionCode: code
        });
      } else {
        logger.error('Failed to fetch competition matches.', {
          competitionCode: code,
          status,
          message: err.message
        });
      }
      batches.push([]);
    }
  }

  const byId = new Map();
  for (const fixtures of batches) {
    for (const fixture of fixtures) {
      byId.set(fixture.id, fixture);
    }
  }

  const merged = [...byId.values()].sort(
    (a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0)
  );

  if (merged.length === 0 && sawRateLimit) {
    const err = new Error('Request failed with status code 429');
    err.response = { status: 429 };
    throw err;
  }

  return merged;
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
    const finished = await applyMockFinish([fixture]);
    return finished[0] ?? null;
  }

  return withRateLimitRetry(async () => {
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
  }, { matchId });
}

/**
 * @param {{ status?: string, date?: string, competition?: string, forceRefresh?: boolean }} [options]
 * @returns {Promise<import('./footballUtils').NormalizedFixture[]>}
 */
async function refreshSeasonFixturesFromApi() {
  seasonFetchInFlight = fetchSeasonMatchesFromApi().finally(() => {
    seasonFetchInFlight = null;
  });
  return seasonFetchInFlight;
}

async function getSeasonFixtures(options = {}) {
  const now = Date.now();
  const cacheTtlMs = getCacheTtlMs();
  const canUseCache =
    !isMockApiEnabled() &&
    !options.forceRefresh &&
    seasonCache.data &&
    seasonCache.expiresAt > now;

  let fixtures;
  if (canUseCache) {
    fixtures = seasonCache.data;
  } else if (!isMockApiEnabled() && options.forceRefresh && seasonFetchInFlight) {
    fixtures = await seasonFetchInFlight;
  } else {
    try {
      fixtures = await refreshSeasonFixturesFromApi();
      if (!isMockApiEnabled() && fixtures.length > 0) {
        seasonCache = {
          data: fixtures,
          expiresAt: now + cacheTtlMs
        };
      }
    } catch (err) {
      if (err.response?.status === 429 && seasonCache.data?.length) {
        logger.warn('Rate limited; using cached club fixtures.', {
          cachedCount: seasonCache.data.length,
          cacheAgeMs: now - (seasonCache.expiresAt - cacheTtlMs)
        });
        fixtures = seasonCache.data;
      } else {
        throw err;
      }
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
 * @param {{ kickoff?: string, status: string }} fixture
 * @returns {boolean}
 */
function isCachedFixtureStale(fixture) {
  if (!fixture.kickoff || fixture.status === 'FT') return false;
  return new Date(fixture.kickoff).getTime() <= Date.now();
}

/**
 * @param {import('./footballUtils').NormalizedFixture[]} fixtures
 * @returns {Promise<import('./footballUtils').NormalizedFixture[]>}
 */
async function applyMockFinish(fixtures) {
  const { applyMockInstantFinishToFixtures } = require('./predictionMockFinish');
  const mockData = require('./footballMockData');
  const { store } = require('./footballUtils');
  return applyMockInstantFinishToFixtures(
    store,
    mockData.MOCK_PLAYABLE_MATCH_IDS,
    mockData,
    fixtures
  );
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
  if (cached && !isCachedFixtureStale(cached)) return cached;

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
  getCacheTtlMs,
  MIN_REQUEST_GAP_MS
};
