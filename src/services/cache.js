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

const REEL_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const POST_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const DP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_TTL_MS = REEL_TTL_MS;
const CACHE_PREFIX = 'cache:analyze:';

function ttlForMode(mode) {
  switch (mode) {
    case 'post':
      return POST_TTL_MS;
    case 'dp':
      return DP_TTL_MS;
    case 'reel':
    default:
      return REEL_TTL_MS;
  }
}

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

async function saveCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  const fullKey = `${CACHE_PREFIX}${key}`;
  const serialized = JSON.stringify(value);
  const ttlSeconds = Math.max(1, Math.round(ttlMs / 1000));

  if (isRedisEnabled()) {
    await redisSet(fullKey, serialized, ttlSeconds);
  }

  const entry = { value, expiresAt: Date.now() + ttlMs };
  memoryCache.set(fullKey, entry);
  memorySet(fullKey, serialized, ttlMs);
}

function cacheStats() {
  return {
    size: memoryCache.size,
    ttlHours: {
      reel: REEL_TTL_MS / (60 * 60 * 1000),
      post: POST_TTL_MS / (60 * 60 * 1000),
      dp: DP_TTL_MS / (60 * 60 * 1000),
    },
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
  ttlForMode,
  REEL_TTL_MS,
  POST_TTL_MS,
  DP_TTL_MS,
  getSessionState,
  saveSessionState,
  incrementSessionDailyCount,
  getSessionDailyCount,
};
