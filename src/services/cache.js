const cache = new Map();
const TTL_MS = 15 * 60 * 1000;

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function saveCache(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

function cacheStats() {
  return { size: cache.size, ttlMinutes: TTL_MS / 60000 };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = { getFromCache, saveCache, cacheStats };
