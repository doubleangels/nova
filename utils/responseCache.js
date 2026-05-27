/** @type {Map<string, { value: unknown, expiresAt: number }>} */
const cache = new Map();

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
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
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

module.exports = { getCached, setCached, cacheKey, deleteCached, deleteByPrefix };
