const {
  isRedisEnabled,
  getRedis,
  redisGet,
  redisIncr,
  redisExpire,
} = require('./redis');

const KEY_PREFIX = 'analytics';
const TTL_SECONDS = 30 * 86400; // 30 days
const DURATION_SAMPLE_RATE = 0.1;
const MAX_DURATION_SAMPLES = 1000;

const memoryCounters = new Map();
const memoryDurations = new Map();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dayPrefix(day = todayKey()) {
  return `${KEY_PREFIX}:${day}`;
}

function hashIdentifier(urlOrUsername = '') {
  const value = String(urlOrUsername || '');
  const match = value.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (match) return match[2].slice(0, 8);

  const clean = value.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return 'unknown';
  return clean.slice(0, 8);
}

function memoryIncr(key) {
  const next = (memoryCounters.get(key) || 0) + 1;
  memoryCounters.set(key, next);
  return next;
}

function memoryGetCounter(key) {
  return memoryCounters.get(key) || 0;
}

function memoryPushDuration(key, durationMs) {
  const list = memoryDurations.get(key) || [];
  list.unshift(Number(durationMs) || 0);
  if (list.length > MAX_DURATION_SAMPLES) list.length = MAX_DURATION_SAMPLES;
  memoryDurations.set(key, list);
}

function memoryGetDurations(key) {
  return memoryDurations.get(key) || [];
}

async function incrKey(key) {
  const redis = getRedis();
  if (isRedisEnabled() && redis?.status === 'ready') {
    const value = await redisIncr(key);
    await redisExpire(key, TTL_SECONDS);
    return value;
  }
  return memoryIncr(key);
}

async function pushDurationSample(key, durationMs) {
  const redis = getRedis();
  if (isRedisEnabled() && redis?.status === 'ready') {
    try {
      await redis.lpush(key, String(durationMs));
      await redis.ltrim(key, 0, MAX_DURATION_SAMPLES - 1);
      await redis.expire(key, TTL_SECONDS);
      return;
    } catch (err) {
      console.error('[analytics] duration sample failed:', err.message);
    }
  }
  memoryPushDuration(key, durationMs);
}

async function getCounter(key) {
  if (isRedisEnabled()) {
    const raw = await redisGet(key);
    if (raw != null) return parseInt(raw, 10) || 0;
  }
  return memoryGetCounter(key);
}

async function getDurations(key) {
  const redis = getRedis();
  if (isRedisEnabled() && redis?.status === 'ready') {
    try {
      const values = await redis.lrange(key, 0, -1);
      if (values?.length) return values.map(Number).filter((n) => Number.isFinite(n));
    } catch {
      /* fall through */
    }
  }
  return memoryGetDurations(key).filter((n) => Number.isFinite(n));
}

function normalizeSource(source) {
  const value = String(source || 'scraper').toLowerCase();
  if (['device', 'scraper', 'cache', 'session', 'fallback', 'public', 'page_scrape', 'oembed', 'api', 'mobile_api'].includes(value)) {
    if (value === 'public' || value === 'page_scrape' || value === 'oembed' || value === 'api' || value === 'mobile_api') {
      return 'scraper';
    }
    return value;
  }
  return 'scraper';
}

function normalizeReason(reason, success) {
  if (success) return 'ok';
  const value = String(reason || 'unknown').toLowerCase();
  return value.replace(/[^a-z0-9_]/g, '_').slice(0, 64) || 'unknown';
}

async function trackRequest({
  endpoint,
  source,
  success,
  reason,
  durationMs,
  url = '',
  username = '',
} = {}) {
  try {
    const day = todayKey();
    const prefix = dayPrefix(day);
    const safeEndpoint = String(endpoint || 'unknown').toLowerCase();
    const safeSource = normalizeSource(source);
    const safeReason = normalizeReason(reason, success);
    const idHint = hashIdentifier(url || username);

    await Promise.all([
      incrKey(`${prefix}:total`),
      incrKey(`${prefix}:endpoint:${safeEndpoint}`),
      incrKey(`${prefix}:${success ? 'success' : 'failure'}`),
      incrKey(`${prefix}:source:${safeSource}`),
      !success ? incrKey(`${prefix}:reason:${safeReason}`) : Promise.resolve(),
      idHint !== 'unknown' ? incrKey(`${prefix}:id:${idHint}`) : Promise.resolve(),
    ]);

    if (Math.random() < DURATION_SAMPLE_RATE) {
      await pushDurationSample(`${prefix}:durations`, Math.max(0, Math.round(durationMs || 0)));
    }
  } catch (err) {
    console.error('[analytics] Failed to track:', err.message);
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Math.round(sorted[idx]);
}

async function getDailyReport(date = todayKey()) {
  const day = date;
  const prefix = dayPrefix(day);

  const [
    total,
    success,
    failure,
    reel,
    post,
    dp,
    carousel,
    sourceDevice,
    sourceScraper,
    sourceCache,
    sourceSession,
    sourceFallback,
    reasonEmbedStripped,
    reasonRateLimited,
    reasonParseError,
    reasonTimeout,
    reasonPrivate,
    reasonDpTimeout,
    reasonUnknown,
    durations,
  ] = await Promise.all([
    getCounter(`${prefix}:total`),
    getCounter(`${prefix}:success`),
    getCounter(`${prefix}:failure`),
    getCounter(`${prefix}:endpoint:reel`),
    getCounter(`${prefix}:endpoint:post`),
    getCounter(`${prefix}:endpoint:dp`),
    getCounter(`${prefix}:endpoint:carousel`),
    getCounter(`${prefix}:source:device`),
    getCounter(`${prefix}:source:scraper`),
    getCounter(`${prefix}:source:cache`),
    getCounter(`${prefix}:source:session`),
    getCounter(`${prefix}:source:fallback`),
    getCounter(`${prefix}:reason:embed_stripped`),
    getCounter(`${prefix}:reason:rate_limited`),
    getCounter(`${prefix}:reason:parse_error`),
    getCounter(`${prefix}:reason:timeout`),
    getCounter(`${prefix}:reason:private`),
    getCounter(`${prefix}:reason:dp_timeout`),
    getCounter(`${prefix}:reason:unknown`),
    getDurations(`${prefix}:durations`),
  ]);

  const totalNum = total || 0;
  const successNum = success || 0;
  const failureNum = failure || 0;
  const cacheNum = sourceCache || 0;
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const avgDuration = sortedDurations.length
    ? Math.round(sortedDurations.reduce((a, b) => a + b, 0) / sortedDurations.length)
    : 0;

  return {
    date: day,
    summary: {
      total: totalNum,
      success: successNum,
      failure: failureNum,
      successRate: totalNum > 0 ? `${((successNum / totalNum) * 100).toFixed(1)}%` : '0%',
      cacheHitRate: totalNum > 0 ? `${((cacheNum / totalNum) * 100).toFixed(1)}%` : '0%',
    },
    endpoints: {
      reel: reel || 0,
      post: post || 0,
      dp: dp || 0,
      carousel: carousel || 0,
    },
    sources: {
      device: sourceDevice || 0,
      scraper: sourceScraper || 0,
      cache: cacheNum,
      session: sourceSession || 0,
      fallback: sourceFallback || 0,
    },
    failureReasons: {
      embed_stripped: reasonEmbedStripped || 0,
      rate_limited: reasonRateLimited || 0,
      parse_error: reasonParseError || 0,
      timeout: reasonTimeout || 0,
      private: reasonPrivate || 0,
      dp_timeout: reasonDpTimeout || 0,
      unknown: reasonUnknown || 0,
    },
    performance: {
      avgResponseMs: avgDuration,
      p95ResponseMs: percentile(sortedDurations, 0.95),
      samples: sortedDurations.length,
    },
  };
}

async function getWeeklyReport() {
  const reports = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    const day = date.toISOString().slice(0, 10);
    reports.push(await getDailyReport(day));
  }
  return reports;
}

module.exports = {
  trackRequest,
  getDailyReport,
  getWeeklyReport,
  todayKey,
  hashIdentifier,
};
