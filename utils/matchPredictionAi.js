const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

const config = require('../config');
const { AI_REASONING_MAX_LENGTH } = require('./predictionMessages');
const {
  getCached,
  setCached,
  cacheKey,
  deleteByPrefix
} = require('./responseCache');
const {
  DEFAULT_MODEL,
  isGeminiConfigured,
  getGeminiModel,
  parseJsonFromModelText,
  buildGenerateContentBody,
  generateStructuredJson,
  SystemContextCacheManager
} = require('./geminiClient');
const logger = require('../logger')(path.basename(__filename));

const RESULT_CACHE_PREFIX = 'prediction-ai:result:';
const DEFAULT_RESULT_CACHE_MS = 6 * 60 * 60 * 1000;

const predictionContextCache = new SystemContextCacheManager('prediction');

/**
 * @typedef {Object} AiMatchPrediction
 * @property {number} homeScore
 * @property {number} awayScore
 * @property {'home'|'draw'|'away'} resultPick
 * @property {string} reasoning
 * @property {string} model
 */

/**
 * @returns {boolean}
 */
function isMatchAiEnabled() {
  return Boolean(config.predictionAiEnabled && isGeminiConfigured());
}

/**
 * @param {'worldcup'|'club'} game
 * @param {{ id: number, home: string, away: string, kickoff?: string }} fixture
 * @param {boolean} demoMode
 * @returns {string}
 */
function buildResultCacheKey(game, fixture, demoMode) {
  const kickoffBucket = fixture.kickoff
    ? dayjs(fixture.kickoff).utc().format('YYYY-MM-DDTHH')
    : 'tbd';

  return cacheKey(
    RESULT_CACHE_PREFIX,
    game,
    fixture.id,
    getGeminiModel(),
    demoMode ? 'demo' : 'live',
    fixture.home,
    fixture.away,
    kickoffBucket
  );
}

/**
 * @param {{ kickoff?: string }} fixture
 * @returns {number}
 */
function getResultCacheTtlMs(fixture) {
  const fixed = config.geminiPredictionCacheTtlMs;
  if (Number.isFinite(fixed) && fixed > 0) {
    return fixed;
  }

  if (fixture.kickoff) {
    const remaining = new Date(fixture.kickoff).getTime() - Date.now();
    if (remaining > 60_000) {
      return remaining;
    }
  }

  return DEFAULT_RESULT_CACHE_MS;
}

/**
 * @param {number[]} fixtureIds
 * @param {'worldcup'|'club'} [game]
 */
function clearAiPredictionCache(fixtureIds, game) {
  if (game) {
    for (const fixtureId of fixtureIds) {
      deleteByPrefix(`${RESULT_CACHE_PREFIX}${game}:${fixtureId}:`);
    }
  } else {
    for (const fixtureId of fixtureIds) {
      deleteByPrefix(`${RESULT_CACHE_PREFIX}worldcup:${fixtureId}:`);
      deleteByPrefix(`${RESULT_CACHE_PREFIX}club:${fixtureId}:`);
    }
  }

  predictionContextCache.clear();
}

/**
 * @param {number} homeScore
 * @param {number} awayScore
 * @returns {'home'|'draw'|'away'}
 */
function outcomeFromScore(homeScore, awayScore) {
  if (homeScore > awayScore) return 'home';
  if (awayScore > homeScore) return 'away';
  return 'draw';
}

/**
 * @param {unknown} raw
 * @param {{ home: string, away: string }} fixture
 * @returns {'home'|'draw'|'away'|null}
 */
function parseWinnerPick(raw, fixture) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'draw' || normalized === 'd') return 'draw';
  if (normalized === 'home' || normalized === 'h') return 'home';
  if (normalized === 'away' || normalized === 'a') return 'away';

  const homeNorm = fixture.home.trim().toLowerCase();
  const awayNorm = fixture.away.trim().toLowerCase();
  if (normalized === homeNorm) return 'home';
  if (normalized === awayNorm) return 'away';
  return null;
}

/**
 * @param {unknown} parsed
 * @param {{ home: string, away: string }} fixture
 * @returns {AiMatchPrediction|null}
 */
function normalizeAiResponse(parsed, fixture) {
  if (!parsed || typeof parsed !== 'object') return null;

  const homeScore = parseInt(String(parsed.homeScore), 10);
  const awayScore = parseInt(String(parsed.awayScore), 10);
  if (
    !Number.isInteger(homeScore) ||
    !Number.isInteger(awayScore) ||
    homeScore < 0 ||
    homeScore > 15 ||
    awayScore < 0 ||
    awayScore > 15
  ) {
    return null;
  }

  const fromWinner = parseWinnerPick(parsed.winner, fixture);
  const fromScore = outcomeFromScore(homeScore, awayScore);
  const resultPick = fromWinner === fromScore ? fromWinner : fromScore;

  let reasoning = String(parsed.reasoning || parsed.summary || '').trim();
  if (reasoning.length > AI_REASONING_MAX_LENGTH) {
    reasoning = `${reasoning.slice(0, AI_REASONING_MAX_LENGTH - 1)}…`;
  }

  return {
    homeScore,
    awayScore,
    resultPick,
    reasoning,
    model: getGeminiModel()
  };
}

/**
 * @returns {boolean}
 */
function isDemoPredictionMode() {
  return Boolean(config.predictionMockApi);
}

/**
 * @param {boolean} [demoMode]
 * @returns {string}
 */
function buildSystemInstruction(demoMode = false) {
  let text =
    'You are a football analyst for a Discord prediction game. ' +
    'You have access to Google Search - use it to check up-to-date team news, form, and context before you predict. ';

  if (demoMode) {
    text +=
      'The bot may be in internal test mode: still treat every fixture as a real upcoming match, ' +
      'research the actual teams and competition, and never refuse or hedge because the match is for testing. ';
  }

  text +=
    'Return only valid JSON with keys homeScore, awayScore, winner, and reasoning. ' +
    'homeScore and awayScore must be integers from 0 to 15. ' +
    'winner must be "home", "draw", or "away" and must match the scoreline. ' +
    `reasoning: one short sentence only, max ${AI_REASONING_MAX_LENGTH} characters, summarising the main current factors (form, injuries, standings); plain text, no markdown.`;

  if (demoMode) {
    text += ' Do not mention demos, mocks, simulations, or Discord tests in reasoning.';
  }

  return text;
}

/**
 * @param {{ game: 'worldcup'|'club', fixture: { id: number, home: string, away: string, kickoff?: string, status?: string, competitionName?: string, competitionCode?: string }, demoMode?: boolean }} params
 * @returns {string}
 */
function buildUserPrompt({ game, fixture, demoMode = false }) {
  const todayUtc = dayjs().utc().format('YYYY-MM-DD');
  const kickoff = fixture.kickoff
    ? dayjs(fixture.kickoff).utc().format('YYYY-MM-DD HH:mm [UTC]')
    : 'TBD';
  const competition =
    fixture.competitionName ||
    fixture.competitionCode ||
    (game === 'worldcup' ? 'FIFA World Cup' : 'Club football');
  const home = fixture.home;
  const away = fixture.away;

  const lines = [`Today (UTC): ${todayUtc}`, ''];

  if (demoMode) {
    lines.push(
      'IMPORTANT - Bot test mode is on, but predict as for a REAL match:',
      `- Treat **${home} vs ${away}** as a genuine upcoming fixture at the kickoff below.`,
      '- Use Google Search for real-world current form, injuries, standings, and news for both teams.',
      '- Do not describe the match as fake, demo, mock, simulated, or a Discord test.',
      ''
    );
  }

  lines.push(
    'Use Google Search to research CURRENT information for this fixture before you predict, including:',
    `- Recent results and form for ${home} and ${away}`,
    `- Injuries, suspensions, or notable squad/absence news`,
    `- Competition context (table position, knockout stage, stakes)`,
    '- Any reliable pre-match reporting on tactics or head-to-head trends',
    '',
    'Match:',
    `- Competition: ${competition}`,
    `- ${home} (home) vs ${away} (away)`,
    `- Kickoff: ${kickoff}`,
    `- Fixture status: ${fixture.status || 'scheduled'}`,
    '',
    'Predict the full-time score and winner based on what you find.',
    `In reasoning, one brief sentence (max ${AI_REASONING_MAX_LENGTH} characters) on the main current factors you relied on.`,
    '',
    'Respond with JSON only, for example:',
    '{"homeScore":2,"awayScore":1,"winner":"home","reasoning":"..."}'
  );

  return lines.join('\n');
}

/**
 * @param {string} userPrompt
 * @param {boolean} [demoMode]
 * @param {string} [cachedContentName]
 * @returns {object}
 */
function buildGeminiRequestBody(userPrompt, demoMode = false, cachedContentName) {
  return buildGenerateContentBody(
    userPrompt,
    buildSystemInstruction(demoMode),
    {
      temperature: 0.35,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          homeScore: { type: 'integer' },
          awayScore: { type: 'integer' },
          winner: { type: 'string', enum: ['home', 'draw', 'away'] },
          reasoning: { type: 'string', maxLength: AI_REASONING_MAX_LENGTH }
        },
        required: ['homeScore', 'awayScore', 'winner', 'reasoning']
      }
    },
    cachedContentName
  );
}

/**
 * @param {boolean} demoMode
 * @returns {string}
 */
function systemContextCacheKey(demoMode) {
  return demoMode ? 'demo' : 'live';
}

/**
 * @param {boolean} demoMode
 * @returns {Promise<string|null>}
 */
async function getOrCreateSystemContextCache(demoMode) {
  const key = systemContextCacheKey(demoMode);
  return predictionContextCache.getOrCreate(
    key,
    buildSystemInstruction(demoMode),
    `nova-prediction-${demoMode ? 'demo' : 'live'}`
  );
}

/**
 * @param {string} userPrompt
 * @param {boolean} [demoMode]
 * @returns {Promise<unknown|null>}
 */
async function callGeminiForPrediction(userPrompt, demoMode = false) {
  const cachedContentName = await getOrCreateSystemContextCache(demoMode);

  return generateStructuredJson({
    userPrompt,
    systemInstruction: buildSystemInstruction(demoMode),
    cachedContentName: cachedContentName || undefined,
    responseSchema: {
      type: 'object',
      properties: {
        homeScore: { type: 'integer' },
        awayScore: { type: 'integer' },
        winner: { type: 'string', enum: ['home', 'draw', 'away'] },
        reasoning: { type: 'string', maxLength: AI_REASONING_MAX_LENGTH }
      },
      required: ['homeScore', 'awayScore', 'winner', 'reasoning']
    },
    logLabel: 'match-prediction'
  });
}

/**
 * @param {{ game: 'worldcup'|'club', fixture: { id: number, home: string, away: string, kickoff?: string, status?: string, competitionName?: string, competitionCode?: string }, forceRefresh?: boolean }} params
 * @returns {Promise<AiMatchPrediction|null>}
 */
async function fetchMatchAiPrediction(params) {
  if (!isMatchAiEnabled()) return null;

  const { game, fixture, forceRefresh = false } = params;
  const demoMode = isDemoPredictionMode();
  const resultKey = buildResultCacheKey(game, fixture, demoMode);

  if (!forceRefresh) {
    const cached = getCached(resultKey);
    if (cached) {
      logger.debug('Gemini match prediction served from result cache.', {
        game,
        fixtureId: fixture.id
      });
      return cached;
    }
  }

  try {
    const userPrompt = buildUserPrompt({ game, fixture, demoMode });
    const parsed = await callGeminiForPrediction(userPrompt, demoMode);
    const normalized = normalizeAiResponse(parsed, fixture);

    if (!normalized) {
      logger.warn('Gemini returned an invalid match prediction payload.', {
        game,
        fixtureId: fixture.id,
        model: getGeminiModel(),
        demoMode
      });
      return null;
    }

    setCached(resultKey, normalized, getResultCacheTtlMs(fixture));
    logger.info('Gemini match prediction generated.', {
      game,
      fixtureId: fixture.id,
      homeScore: normalized.homeScore,
      awayScore: normalized.awayScore,
      resultPick: normalized.resultPick,
      grounded: true,
      demoMode,
      cacheTtlMs: getResultCacheTtlMs(fixture)
    });
    return normalized;
  } catch (err) {
    logger.error('Gemini match prediction request failed.', {
      err,
      game,
      fixtureId: fixture.id,
      model: getGeminiModel()
    });
    return null;
  }
}

module.exports = {
  DEFAULT_MODEL,
  isMatchAiEnabled,
  isDemoPredictionMode,
  getGeminiModel,
  buildResultCacheKey,
  getResultCacheTtlMs,
  clearAiPredictionCache,
  fetchMatchAiPrediction,
  normalizeAiResponse,
  buildSystemInstruction,
  buildUserPrompt,
  buildGeminiRequestBody,
  getOrCreateSystemContextCache,
  parseJsonFromModelText
};
