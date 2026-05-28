const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

const config = require('../config');
const {
  getCached,
  setCached,
  cacheKey
} = require('./responseCache');
const {
  isGeminiConfigured,
  getGeminiModel,
  generateStructuredJson,
  SystemContextCacheManager
} = require('./geminiClient');
const { AI_CONTEXT_MAX_LENGTH, truncateContext } = require('./geminiContextMessages');
const logger = require('../logger')(path.basename(__filename));

const RESULT_CACHE_PREFIX = 'command-context-ai:';
const DEFAULT_RESULT_CACHE_MS = 60 * 60 * 1000;

const contextCacheManagers = {
  weather: new SystemContextCacheManager('weather-context'),
  anime: new SystemContextCacheManager('anime-context'),
  imdb: new SystemContextCacheManager('imdb-context'),
  book: new SystemContextCacheManager('book-context'),
  google: new SystemContextCacheManager('google-context'),
  googleimages: new SystemContextCacheManager('googleimages-context')
};

const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string', maxLength: AI_CONTEXT_MAX_LENGTH }
  },
  required: ['note']
};

/**
 * @typedef {Object} CommandAiContext
 * @property {string} note
 * @property {string} model
 */

/**
 * @param {boolean} featureEnabled
 * @returns {boolean}
 */
function isCommandAiEnabled(featureEnabled) {
  return Boolean(featureEnabled && isGeminiConfigured());
}

/**
 * @returns {number}
 */
function getCommandContextCacheTtlMs() {
  const fixed = config.geminiCommandContextCacheTtlMs;
  if (Number.isFinite(fixed) && fixed > 0) {
    return fixed;
  }
  return DEFAULT_RESULT_CACHE_MS;
}

/**
 * @param {unknown} parsed
 * @returns {CommandAiContext|null}
 */
function normalizeNoteResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const note = truncateContext(String(parsed.note || parsed.summary || '').trim());
  if (!note) return null;
  return { note, model: getGeminiModel() };
}

/**
 * @param {{
 *   domain: 'weather'|'anime'|'imdb'|'book'|'google'|'googleimages',
 *   featureEnabled: boolean,
 *   cacheKeyParts: string[],
 *   systemInstruction: string,
 *   buildUserPrompt: () => string,
 *   displayName: string,
 *   contextCacheKey?: string
 * }} params
 * @returns {Promise<CommandAiContext|null>}
 */
async function fetchCommandContext(params) {
  const {
    domain,
    featureEnabled,
    cacheKeyParts,
    systemInstruction,
    buildUserPrompt,
    displayName,
    contextCacheKey = 'default'
  } = params;

  if (!isCommandAiEnabled(featureEnabled)) return null;

  const resultKey = cacheKey(RESULT_CACHE_PREFIX, domain, getGeminiModel(), ...cacheKeyParts);
  const cached = getCached(resultKey);
  if (cached) {
    return cached;
  }

  const cacheManager = contextCacheManagers[domain];
  const userPrompt = buildUserPrompt();

  try {
    const cachedContentName = await cacheManager.getOrCreate(
      contextCacheKey,
      systemInstruction,
      displayName
    );

    const parsed = await generateStructuredJson({
      userPrompt,
      systemInstruction,
      cachedContentName: cachedContentName || undefined,
      responseSchema: NOTE_SCHEMA,
      logLabel: `command-context-${domain}`
    });

    const normalized = normalizeNoteResponse(parsed);
    if (!normalized) {
      logger.warn('Gemini returned an invalid command context payload.', { domain });
      return null;
    }

    setCached(resultKey, normalized, getCommandContextCacheTtlMs());
    logger.info('Gemini command context generated.', { domain, model: normalized.model });
    return normalized;
  } catch (err) {
    logger.error('Gemini command context request failed.', { err, domain });
    return null;
  }
}

const WEATHER_SYSTEM =
  'You are a weather assistant for a Discord bot. Use Google Search for current local weather advisories, warnings, or notable conditions when relevant. ' +
  `Return JSON with key "note" only: one or two short sentences (max ${AI_CONTEXT_MAX_LENGTH} characters) with practical outlook advice (what to plan for). Plain text, no markdown. ` +
  'Base advice on the forecast data provided; use search only for official advisories or breaking local weather news. Do not repeat every number from the forecast.';

/**
 * @param {{ place: string, summary: string, forecastSnippet: string, units: string }} input
 * @returns {Promise<CommandAiContext|null>}
 */
async function fetchWeatherContext(input) {
  return fetchCommandContext({
    domain: 'weather',
    featureEnabled: config.weatherAiEnabled,
    cacheKeyParts: [
      input.place.toLowerCase(),
      input.units,
      dayjs().utc().format('YYYY-MM-DD')
    ],
    systemInstruction: WEATHER_SYSTEM,
    displayName: 'nova-weather-context',
    buildUserPrompt: () =>
      [
        `Today (UTC): ${dayjs().utc().format('YYYY-MM-DD')}`,
        `Location: ${input.place}`,
        `Units: ${input.units}`,
        `Current summary: ${input.summary}`,
        '',
        'Forecast:',
        input.forecastSnippet,
        '',
        'Use Google Search if needed for active weather advisories for this area.',
        'Respond with JSON: {"note":"..."}'
      ].join('\n')
  });
}

const ANIME_SYSTEM =
  'You are an anime assistant for a Discord bot. Use Google Search for current airing status, season news, hiatus announcements, or recent episode info. ' +
  `Return JSON with key "note" only: one or two short sentences (max ${AI_CONTEXT_MAX_LENGTH} characters) on where the anime stands now (airing, completed, upcoming season). Plain text, no markdown. ` +
  'Do not repeat the full synopsis.';

/**
 * @param {{ title: string, malId: number, rating: string, genres: string, releaseDate: string, synopsisSnippet: string }} input
 * @returns {Promise<CommandAiContext|null>}
 */
async function fetchAnimeContext(input) {
  return fetchCommandContext({
    domain: 'anime',
    featureEnabled: config.animeAiEnabled,
    cacheKeyParts: [String(input.malId), dayjs().utc().format('YYYY-MM-DD')],
    systemInstruction: ANIME_SYSTEM,
    displayName: 'nova-anime-context',
    buildUserPrompt: () =>
      [
        `Today (UTC): ${dayjs().utc().format('YYYY-MM-DD')}`,
        `Title: ${input.title}`,
        `MAL ID: ${input.malId}`,
        `MAL rating: ${input.rating}`,
        `Genres: ${input.genres}`,
        `Release: ${input.releaseDate}`,
        `Synopsis excerpt: ${input.synopsisSnippet}`,
        '',
        'Use Google Search for current status of this anime.',
        'Respond with JSON: {"note":"..."}'
      ].join('\n')
  });
}

const IMDB_SYSTEM =
  'You are a film and TV assistant for a Discord bot. Use Google Search for recent news: renewals, cancellations, sequels, awards buzz, or where to watch. ' +
  `Return JSON with key "note" only: one or two short sentences (max ${AI_CONTEXT_MAX_LENGTH} characters) of timely context. Plain text, no markdown. ` +
  'Do not repeat the plot summary.';

/**
 * @param {{ title: string, year: string, typeLabel: string, imdbId: string, rating: string, genre: string, plotSnippet: string }} input
 * @returns {Promise<CommandAiContext|null>}
 */
async function fetchImdbContext(input) {
  return fetchCommandContext({
    domain: 'imdb',
    featureEnabled: config.imdbAiEnabled,
    cacheKeyParts: [
      input.imdbId || input.title.toLowerCase(),
      dayjs().utc().format('YYYY-MM-DD')
    ],
    systemInstruction: IMDB_SYSTEM,
    displayName: 'nova-imdb-context',
    buildUserPrompt: () =>
      [
        `Today (UTC): ${dayjs().utc().format('YYYY-MM-DD')}`,
        `${input.typeLabel}: ${input.title} (${input.year})`,
        input.imdbId ? `IMDb ID: ${input.imdbId}` : '',
        `IMDb rating: ${input.rating}`,
        `Genre: ${input.genre}`,
        `Plot excerpt: ${input.plotSnippet}`,
        '',
        'Use Google Search for recent news about this title.',
        'Respond with JSON: {"note":"..."}'
      ]
        .filter(Boolean)
        .join('\n')
  });
}

const BOOK_SYSTEM =
  'You are a book recommendation assistant for a Discord bot. Use Google Search for recent reviews, awards, or reader reception when helpful. ' +
  `Return JSON with key "note" only: one or two short sentences (max ${AI_CONTEXT_MAX_LENGTH} characters) with a reader-focused take. Plain text, no markdown. ` +
  'Do not repeat the publisher description verbatim.';

/**
 * @param {{ title: string, authors: string, bookId: string, publishedDate: string, rating: string, descriptionSnippet: string }} input
 * @returns {Promise<CommandAiContext|null>}
 */
async function fetchBookContext(input) {
  return fetchCommandContext({
    domain: 'book',
    featureEnabled: config.bookAiEnabled,
    cacheKeyParts: [input.bookId, dayjs().utc().format('YYYY-MM-DD')],
    systemInstruction: BOOK_SYSTEM,
    displayName: 'nova-book-context',
    buildUserPrompt: () =>
      [
        `Today (UTC): ${dayjs().utc().format('YYYY-MM-DD')}`,
        `Title: ${input.title}`,
        `Authors: ${input.authors}`,
        `Published: ${input.publishedDate}`,
        input.rating ? `Google Books rating: ${input.rating}` : '',
        `Description excerpt: ${input.descriptionSnippet}`,
        '',
        'Use Google Search for reception or notable recent news about this book.',
        'Respond with JSON: {"note":"..."}'
      ]
        .filter(Boolean)
        .join('\n')
  });
}

const GOOGLE_SEARCH_SYSTEM =
  'You are a search assistant for a Discord bot. The user already ran a Google web search; you may use Google Search for extra context about this specific result. ' +
  `Return JSON with key "note" only: one or two short sentences (max ${AI_CONTEXT_MAX_LENGTH} characters) explaining why this result matters for the query or what to expect on the page. Plain text, no markdown. ` +
  'Do not repeat the snippet verbatim.';

/**
 * @param {{ query: string, resultTitle: string, resultSnippet: string, resultLink: string, resultIndex: number }} input
 * @returns {Promise<CommandAiContext|null>}
 */
async function fetchGoogleSearchContext(input) {
  return fetchCommandContext({
    domain: 'google',
    featureEnabled: config.googleAiEnabled,
    cacheKeyParts: [
      input.query.toLowerCase(),
      String(input.resultIndex),
      input.resultLink || input.resultTitle.toLowerCase(),
      dayjs().utc().format('YYYY-MM-DD')
    ],
    systemInstruction: GOOGLE_SEARCH_SYSTEM,
    displayName: 'nova-google-context',
    buildUserPrompt: () =>
      [
        `Today (UTC): ${dayjs().utc().format('YYYY-MM-DD')}`,
        `Search query: ${input.query}`,
        `Result #${input.resultIndex + 1}: ${input.resultTitle}`,
        input.resultLink ? `URL: ${input.resultLink}` : '',
        `Snippet: ${input.resultSnippet}`,
        '',
        'Use Google Search only if you need more context about this result.',
        'Respond with JSON: {"note":"..."}'
      ]
        .filter(Boolean)
        .join('\n')
  });
}

const GOOGLE_IMAGES_SYSTEM =
  'You are an image search assistant for a Discord bot. The user searched Google Images; you may use Google Search to identify what the image likely shows or why it matches the query. ' +
  `Return JSON with key "note" only: one or two short sentences (max ${AI_CONTEXT_MAX_LENGTH} characters) describing the subject or relevance. Plain text, no markdown.`;

/**
 * @param {{ query: string, title: string, contextLink: string, imageLink: string, resultIndex: number }} input
 * @returns {Promise<CommandAiContext|null>}
 */
async function fetchGoogleImagesContext(input) {
  return fetchCommandContext({
    domain: 'googleimages',
    featureEnabled: config.googleImagesAiEnabled,
    cacheKeyParts: [
      input.query.toLowerCase(),
      String(input.resultIndex),
      input.contextLink || input.imageLink || input.title.toLowerCase(),
      dayjs().utc().format('YYYY-MM-DD')
    ],
    systemInstruction: GOOGLE_IMAGES_SYSTEM,
    displayName: 'nova-googleimages-context',
    buildUserPrompt: () =>
      [
        `Today (UTC): ${dayjs().utc().format('YYYY-MM-DD')}`,
        `Image search query: ${input.query}`,
        `Result #${input.resultIndex + 1}: ${input.title}`,
        input.contextLink ? `Source page: ${input.contextLink}` : '',
        input.imageLink ? `Image URL: ${input.imageLink}` : '',
        '',
        'Respond with JSON: {"note":"..."}'
      ]
        .filter(Boolean)
        .join('\n')
  });
}

module.exports = {
  isCommandAiEnabled,
  fetchWeatherContext,
  fetchAnimeContext,
  fetchImdbContext,
  fetchBookContext,
  fetchGoogleSearchContext,
  fetchGoogleImagesContext,
  normalizeNoteResponse
};
