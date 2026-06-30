const Redis = require('ioredis');

let client = null;
let memoryStore = new Map();

function isRedisEnabled() {
  return Boolean(process.env.REDIS_URL);
}

function getRedis() {
  if (!isRedisEnabled()) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    client.on('error', (err) => {
      console.error('[redis] connection error:', err.message);
    });
  }
  return client;
}

async function connectRedis() {
  const redis = getRedis();
  if (!redis) return false;
  if (redis.status === 'ready') return true;
  try {
    await redis.connect();
    console.log('[redis] connected');
    return true;
  } catch (err) {
    console.error('[redis] connect failed:', err.message);
    return false;
  }
}

async function redisGet(key) {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function redisSet(key, value, ttlSeconds) {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return false;
  try {
    if (ttlSeconds) {
      await redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await redis.set(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

async function redisIncr(key) {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return null;
  try {
    return await redis.incr(key);
  } catch {
    return null;
  }
}

async function redisExpire(key, ttlSeconds) {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return;
  try {
    await redis.expire(key, ttlSeconds);
  } catch {
    /* ignore */
  }
}

async function redisHGetAll(key) {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return null;
  try {
    return await redis.hgetall(key);
  } catch {
    return null;
  }
}

async function redisHSet(key, data) {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return false;
  try {
    await redis.hset(key, data);
    return true;
  } catch {
    return false;
  }
}

async function redisDel(key) {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return false;
  try {
    await redis.del(key);
    return true;
  } catch {
    return false;
  }
}

async function redisStatus() {
  if (!isRedisEnabled()) {
    return { enabled: false, connected: false, mode: 'memory' };
  }
  const redis = getRedis();
  const connected = redis?.status === 'ready';
  return {
    enabled: true,
    connected,
    mode: connected ? 'redis' : 'memory-fallback',
    status: redis?.status || 'disconnected',
  };
}

function memoryGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key, value, ttlMs) {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

module.exports = {
  isRedisEnabled,
  getRedis,
  connectRedis,
  redisGet,
  redisSet,
  redisIncr,
  redisExpire,
  redisHGetAll,
  redisHSet,
  redisDel,
  redisStatus,
  memoryGet,
  memorySet,
};
