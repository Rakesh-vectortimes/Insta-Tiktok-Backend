const { redisGet, redisSet, redisDel, isRedisEnabled } = require('./redis');
const { videoCacheKey, jobLockKey } = require('../utils/urlHash');

const CACHE_TTL_SECONDS = parseInt(
  process.env.VIDEO_CACHE_TTL_SECONDS || String(60 * 60 * 24),
  10
);
const LOCK_TTL_SECONDS = parseInt(
  process.env.JOB_LOCK_TTL_SECONDS || String(60 * 10),
  10
);

const memoryVideoCache = new Map();
const memoryLocks = new Map();

async function getVideoCache(hash) {
  const key = videoCacheKey(hash);

  if (isRedisEnabled()) {
    const raw = await redisGet(key);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
  }

  const entry = memoryVideoCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryVideoCache.delete(key);
    return null;
  }
  return entry.value;
}

async function setVideoCache(hash, data) {
  const key = videoCacheKey(hash);
  const serialized = JSON.stringify(data);

  if (isRedisEnabled()) {
    await redisSet(key, serialized, CACHE_TTL_SECONDS);
  }

  memoryVideoCache.set(key, {
    value: data,
    expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
  });
}

async function getJobLock(hash) {
  const key = jobLockKey(hash);

  if (isRedisEnabled()) {
    return await redisGet(key);
  }

  const entry = memoryLocks.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryLocks.delete(key);
    return null;
  }
  return entry.jobId;
}

async function setJobLock(hash, jobId) {
  const key = jobLockKey(hash);

  if (isRedisEnabled()) {
    await redisSet(key, jobId, LOCK_TTL_SECONDS);
  }

  memoryLocks.set(key, {
    jobId,
    expiresAt: Date.now() + LOCK_TTL_SECONDS * 1000,
  });
}

async function clearJobLock(hash) {
  const key = jobLockKey(hash);

  if (isRedisEnabled()) {
    await redisDel(key);
  }

  memoryLocks.delete(key);
}

function videoCacheStats() {
  return {
    memoryEntries: memoryVideoCache.size,
    ttlHours: CACHE_TTL_SECONDS / 3600,
    lockTtlMinutes: LOCK_TTL_SECONDS / 60,
  };
}

module.exports = {
  getVideoCache,
  setVideoCache,
  getJobLock,
  setJobLock,
  clearJobLock,
  videoCacheStats,
  CACHE_TTL_SECONDS,
};
