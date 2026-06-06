/** @type {Map<string, { value: unknown, expiresAt: number }>} */
const cache = new Map();

/** Max in-memory entries before oldest/expired keys are evicted. */
const MAX_CACHE_ENTRIES = 512;

function evictExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
}

function evictOldestEntry() {
  let oldestKey = null;
  let oldestExpiry = Infinity;
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt < oldestExpiry) {
      oldestExpiry = entry.expiresAt;
      oldestKey = key;
    }
  }
  /* istanbul ignore else -- cache is empty */
  if (oldestKey != null) {
    cache.delete(oldestKey);
  }
}

function enforceCacheSizeLimit() {
  evictExpiredEntries();
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const sizeBefore = cache.size;
    evictOldestEntry();
    /* istanbul ignore next -- defensive guard when the cache is unexpectedly empty */
    if (cache.size === sizeBefore) break;
  }
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached(key, value, ttlMs = 900000) {
  enforceCacheSizeLimit();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  enforceCacheSizeLimit();
}

function cacheKey(...parts) {
  return parts.map((p) => String(p).toLowerCase()).join(':');
}

/**
 * @param {string} key
 */
function deleteCached(key) {
  cache.delete(key);
}

/**
 * @param {string} prefix
 */
function deleteByPrefix(prefix) {
  const normalized = String(prefix).toLowerCase();
  for (const key of cache.keys()) {
    if (key.startsWith(normalized)) {
      cache.delete(key);
    }
  }
}

/** Clears all cached entries (for tests). */
function clearCache() {
  cache.clear();
}

module.exports = {
  getCached,
  setCached,
  cacheKey,
  deleteCached,
  deleteByPrefix,
  clearCache,
  MAX_CACHE_ENTRIES
};
