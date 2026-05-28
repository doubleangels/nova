const path = require('path');
const config = require('../config');
const axios = require('./httpClient');
const logger = require('../logger')(path.basename(__filename));

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const REQUEST_TIMEOUT_MS = 45000;
const CONTEXT_CACHE_REFRESH_BUFFER_MS = 60 * 1000;

/**
 * @returns {boolean}
 */
function isGeminiConfigured() {
  return Boolean(config.geminiApiKey && String(config.geminiApiKey).trim());
}

/**
 * @returns {string}
 */
function getGeminiModel() {
  const model =
    config.geminiContextModel ||
    config.geminiPredictionModel ||
    DEFAULT_MODEL;
  return String(model).trim() || DEFAULT_MODEL;
}

/**
 * @param {string} text
 * @returns {unknown|null}
 */
function parseJsonFromModelText(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch {
        return null;
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * @param {unknown} usageMetadata
 * @returns {{ cachedTokens: number, promptTokens: number }}
 */
function readUsageMetadata(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object') {
    return { cachedTokens: 0, promptTokens: 0 };
  }

  return {
    cachedTokens: Number(usageMetadata.cached_content_token_count) || 0,
    promptTokens: Number(usageMetadata.prompt_token_count) || 0
  };
}

/**
 * @param {string} userPrompt
 * @param {string} systemInstruction
 * @param {object} generationConfig
 * @param {string} [cachedContentName]
 * @param {boolean} [useGoogleSearch]
 * @returns {object}
 */
function buildGenerateContentBody(
  userPrompt,
  systemInstruction,
  generationConfig,
  cachedContentName,
  useGoogleSearch = true
) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig
  };

  if (useGoogleSearch) {
    body.tools = [{ google_search: {} }];
  }

  if (cachedContentName) {
    body.cachedContent = cachedContentName;
  } else if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  return body;
}

/**
 * @param {string} systemInstruction
 * @param {string} displayName
 * @returns {Promise<string|null>}
 */
async function createSystemContextCache(systemInstruction, displayName) {
  if (!isGeminiConfigured()) return null;

  const ttlSeconds = config.geminiContextCacheTtlSeconds || 3600;
  const model = getGeminiModel();

  try {
    const response = await axios.post(
      `${GEMINI_API_BASE}/cachedContents`,
      {
        model: `models/${model}`,
        displayName,
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        ttl: `${ttlSeconds}s`
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.geminiApiKey
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    );

    const name = response.data?.name;
    if (!name) return null;

    logger.info('Gemini system instruction context cache created.', {
      displayName,
      model,
      ttlSeconds,
      cachedContent: name
    });

    return name;
  } catch (err) {
    logger.warn('Gemini context cache unavailable; using inline system instruction.', {
      err,
      displayName,
      model
    });
    return null;
  }
}

/**
 * @param {{
 *   userPrompt: string,
 *   systemInstruction: string,
 *   responseSchema: object,
 *   cachedContentName?: string,
 *   temperature?: number,
 *   maxOutputTokens?: number,
 *   useGoogleSearch?: boolean,
 *   logLabel?: string
 * }} params
 * @returns {Promise<unknown|null>}
 */
async function generateStructuredJson(params) {
  if (!isGeminiConfigured()) return null;

  const {
    userPrompt,
    systemInstruction,
    responseSchema,
    cachedContentName,
    temperature = 0.35,
    maxOutputTokens = 512,
    useGoogleSearch = true,
    logLabel = 'gemini'
  } = params;

  const model = getGeminiModel();
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;
  const generationConfig = {
    temperature,
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema
  };

  const response = await axios.post(
    url,
    buildGenerateContentBody(
      userPrompt,
      systemInstruction,
      generationConfig,
      cachedContentName,
      useGoogleSearch
    ),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey
      },
      timeout: REQUEST_TIMEOUT_MS
    }
  );

  const usage = readUsageMetadata(response.data?.usageMetadata);
  if (usage.cachedTokens > 0 || usage.promptTokens > 0) {
    logger.debug('Gemini token usage.', {
      logLabel,
      cachedTokens: usage.cachedTokens,
      promptTokens: usage.promptTokens,
      usedContextCache: Boolean(cachedContentName)
    });
  }

  const parts = response.data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  const text = parts.map(part => part?.text).filter(Boolean).join('');
  return parseJsonFromModelText(text);
}

/**
 * Manages Gemini cachedContents for a fixed system instruction per cache key.
 */
class SystemContextCacheManager {
  /**
   * @param {string} namespace
   */
  constructor(namespace) {
    this.namespace = namespace;
    /** @type {Map<string, { name: string, expiresAt: number }>} */
    this.entries = new Map();
  }

  /**
   * @param {string} cacheKey
   * @returns {string}
   */
  fullKey(cacheKey) {
    return `${this.namespace}:${cacheKey}:${getGeminiModel()}`;
  }

  /**
   * @param {string} cacheKey
   * @param {string} systemInstruction
   * @param {string} displayName
   * @returns {Promise<string|null>}
   */
  async getOrCreate(cacheKey, systemInstruction, displayName) {
    const key = this.fullKey(cacheKey);
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.name;
    }

    const name = await createSystemContextCache(systemInstruction, displayName);
    if (!name) return null;

    const ttlSeconds = config.geminiContextCacheTtlSeconds || 3600;
    this.entries.set(key, {
      name,
      expiresAt:
        Date.now() + ttlSeconds * 1000 - CONTEXT_CACHE_REFRESH_BUFFER_MS
    });

    return name;
  }

  clear() {
    this.entries.clear();
  }
}

module.exports = {
  GEMINI_API_BASE,
  DEFAULT_MODEL,
  REQUEST_TIMEOUT_MS,
  isGeminiConfigured,
  getGeminiModel,
  parseJsonFromModelText,
  readUsageMetadata,
  buildGenerateContentBody,
  createSystemContextCache,
  generateStructuredJson,
  SystemContextCacheManager
};
