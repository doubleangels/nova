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

module.exports = { getCached, setCached, cacheKey };
