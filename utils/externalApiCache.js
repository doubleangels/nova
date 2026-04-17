const crypto = require('crypto');
const NodeCache = require('node-cache');

/**
 * Bounded in-memory cache + inflight deduplication for paid / quota-sensitive HTTP APIs.
 *
 * Env (optional):
 *   GOOGLE_CACHE_TTL_SEC — default 600 (10m) for Google CSE, Books, YouTube
 *   DEEPL_CACHE_TTL_SEC — default 180 (3m) for DeepL translations
 *   EXTERNAL_API_CACHE_MAX_KEYS — default 500 (shared cap for google + deepl namespaces)
 */
function envInt(name, def) {
  const v = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

const googleTtlSec = envInt('GOOGLE_CACHE_TTL_SEC', 600);
const deeplTtlSec = envInt('DEEPL_CACHE_TTL_SEC', 180);
const maxKeys = envInt('EXTERNAL_API_CACHE_MAX_KEYS', 500);

const cache = new NodeCache({
  stdTTL: googleTtlSec,
  maxKeys,
  checkperiod: 120,
  useClones: false
});

/** @type {Map<string, Promise<unknown>>} */
const inflight = new Map();

/**
 * @param {string} kind
 * @param {string} key
 * @param {number} ttlSec
 * @param {() => Promise<T>} factory
 * @returns {Promise<T>}
 * @template T
 */
async function getOrSet(kind, key, ttlSec, factory) {
  const fullKey = `${kind}:${key}`;
  const hit = cache.get(fullKey);
  if (hit !== undefined) {
    return hit;
  }
  const pending = inflight.get(fullKey);
  if (pending) {
    return pending;
  }
  const promise = (async () => {
    try {
      const val = await factory();
      cache.set(fullKey, val, ttlSec);
      return val;
    } finally {
      inflight.delete(fullKey);
    }
  })();
  inflight.set(fullKey, promise);
  return promise;
}

/**
 * Stable short hash for cache keys (avoid huge keys for long queries).
 * @param {string} s
 * @returns {string}
 */
function hashKeyPart(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 32);
}

/**
 * @param {string} query
 * @returns {string}
 */
function normalizeQuery(query) {
  return String(query || '').trim().replace(/\s+/g, ' ');
}

module.exports = {
  getOrSet,
  hashKeyPart,
  normalizeQuery,
  googleTtlSec,
  deeplTtlSec,
  maxKeys,
  /** @type {import('node-cache')} */
  _cache: cache
};
