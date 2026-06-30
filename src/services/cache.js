const fs = require('fs');
const path = require('path');
const {
  isRedisEnabled,
  redisGet,
  redisSet,
  redisIncr,
  redisExpire,
  redisHGetAll,
  redisHSet,
  memoryGet,
  memorySet,
} = require('./redis');

const TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || '900', 10);
const TTL_MS = TTL_SECONDS * 1000;
const CACHE_PREFIX = 'cache:analyze:';

const memoryCache = new Map();
const memorySessionState = new Map();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getFromCache(key) {
  const fullKey = `${CACHE_PREFIX}${key}`;

  if (isRedisEnabled()) {
    const raw = await redisGet(fullKey);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
  }

  const mem = memoryCache.get(fullKey) || memoryGet(fullKey);
  if (!mem) return null;

  if (typeof mem === 'object' && mem.expiresAt) {
    if (Date.now() > mem.expiresAt) {
      memoryCache.delete(fullKey);
      return null;
    }
    return mem.value;
  }

  return mem;
}

async function saveCache(key, value) {
  const fullKey = `${CACHE_PREFIX}${key}`;
  const serialized = JSON.stringify(value);

  if (isRedisEnabled()) {
    await redisSet(fullKey, serialized, TTL_SECONDS);
  }

  const entry = { value, expiresAt: Date.now() + TTL_MS };
  memoryCache.set(fullKey, entry);
  memorySet(fullKey, serialized, TTL_MS);
}

function cacheStats() {
  return {
    size: memoryCache.size,
    ttlMinutes: TTL_SECONDS / 60,
    backend: isRedisEnabled() ? 'redis+memory' : 'memory',
  };
}

async function getSessionState(sessionId) {
  const key = `session:${sessionId}`;

  if (isRedisEnabled()) {
    const data = await redisHGetAll(key);
    if (data && Object.keys(data).length > 0) {
      return {
        session_id: sessionId,
        status: data.status || 'active',
        request_count_today: parseInt(data.request_count_today || '0', 10),
        last_used_at: data.last_used_at || null,
        cooldown_until: data.cooldown_until ? parseInt(data.cooldown_until, 10) : null,
        failed_count: parseInt(data.failed_count || '0', 10),
      };
    }
  }

  return (
    memorySessionState.get(sessionId) || {
      session_id: sessionId,
      status: 'active',
      request_count_today: 0,
      last_used_at: null,
      cooldown_until: null,
      failed_count: 0,
    }
  );
}

async function saveSessionState(sessionId, state) {
  const key = `session:${sessionId}`;
  const payload = {
    status: state.status,
    request_count_today: String(state.request_count_today),
    last_used_at: state.last_used_at || '',
    cooldown_until: state.cooldown_until ? String(state.cooldown_until) : '',
    failed_count: String(state.failed_count),
  };

  if (isRedisEnabled()) {
    await redisHSet(key, payload);
  }

  memorySessionState.set(sessionId, { session_id: sessionId, ...state });
}

async function incrementSessionDailyCount(sessionId) {
  const date = todayKey();
  const counterKey = `session:${sessionId}:count:${date}`;

  if (isRedisEnabled()) {
    const count = await redisIncr(counterKey);
    if (count === 1) {
      await redisExpire(counterKey, 86400 * 2);
    }
    return count;
  }

  const state = await getSessionState(sessionId);
  state.request_count_today += 1;
  await saveSessionState(sessionId, state);
  return state.request_count_today;
}

async function getSessionDailyCount(sessionId) {
  const date = todayKey();
  const counterKey = `session:${sessionId}:count:${date}`;

  if (isRedisEnabled()) {
    const raw = await redisGet(counterKey);
    return raw ? parseInt(raw, 10) : 0;
  }

  const state = await getSessionState(sessionId);
  return state.request_count_today;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (now > entry.expiresAt) memoryCache.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = {
  getFromCache,
  saveCache,
  cacheStats,
  getSessionState,
  saveSessionState,
  incrementSessionDailyCount,
  getSessionDailyCount,
};
