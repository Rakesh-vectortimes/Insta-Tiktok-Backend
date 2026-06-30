const fs = require('fs');
const path = require('path');
const { normalizeCookieContent, writeCookieFile, loadCookieHeaderFromFile } = require('../utils/cookies');
const {
  getSessionState,
  saveSessionState,
  getSessionDailyCount,
  incrementSessionDailyCount,
} = require('./cache');

const SESSIONS_DIR = path.join(__dirname, '../../temp/sessions');
const DEFAULT_MAX_DAILY = parseInt(process.env.SESSION_MAX_DAILY_REQUESTS || '500', 10);
const COOLDOWN_MINUTES = parseInt(process.env.SESSION_COOLDOWN_MINUTES || '15', 10);
const MAX_FAILURES = parseInt(process.env.SESSION_MAX_FAILURES || '5', 10);

let sessions = [];

function unescapeEnv(value = '') {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function parsePoolConfig() {
  if (process.env.INSTAGRAM_SESSION_POOL) {
    try {
      const parsed = JSON.parse(process.env.INSTAGRAM_SESSION_POOL);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (err) {
      console.error('[sessionPool] Invalid INSTAGRAM_SESSION_POOL JSON:', err.message);
    }
  }

  if (process.env.COOKIES_TXT_CONTENT) {
    return [
      {
        id: 'primary',
        cookiesContent: unescapeEnv(process.env.COOKIES_TXT_CONTENT),
        maxDaily: DEFAULT_MAX_DAILY,
      },
    ];
  }

  const { hasCookieFile, getCookieFile } = require('../utils/cookies');
  if (hasCookieFile()) {
    return [
      {
        id: 'primary',
        cookiesPath: getCookieFile(),
        maxDaily: DEFAULT_MAX_DAILY,
      },
    ];
  }

  return [];
}

function initSessionPool() {
  sessions = parsePoolConfig().map((entry) => ({
    id: entry.id || `session_${Math.random().toString(36).slice(2, 8)}`,
    maxDaily: entry.maxDaily || DEFAULT_MAX_DAILY,
    cookiesPath: null,
    cookiesContent: entry.cookiesContent || null,
    sourcePath: entry.cookiesPath || null,
  }));

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  for (const session of sessions) {
    const targetPath = path.join(SESSIONS_DIR, `${session.id}.txt`);

    if (session.cookiesContent) {
      writeCookieFile(targetPath, normalizeCookieContent(session.cookiesContent));
      session.cookiesPath = targetPath;
    } else if (session.sourcePath && fs.existsSync(session.sourcePath)) {
      fs.copyFileSync(session.sourcePath, targetPath);
      session.cookiesPath = targetPath;
    }

    if (!session.cookiesPath || !fs.existsSync(session.cookiesPath)) {
      session.status = 'blocked';
      console.warn(`[sessionPool] Session ${session.id} has no cookie file`);
    } else {
      console.log(`[sessionPool] Loaded session ${session.id} (max ${session.maxDaily}/day)`);
    }
  }

  if (!sessions.length) {
    console.warn('[sessionPool] No sessions configured — session fallback disabled');
  } else {
    console.log(`[sessionPool] ${sessions.length} session(s) ready`);
  }
}

function isSessionAvailable(session, state, dailyCount) {
  if (session.status === 'blocked' || state.status === 'blocked') return false;
  if (state.cooldown_until && Date.now() < state.cooldown_until) return false;
  if (dailyCount >= session.maxDaily) return false;
  return true;
}

async function acquireSession() {
  if (!sessions.length) {
    const err = new Error('No Instagram sessions available in pool');
    err.retryable = true;
    throw err;
  }

  const candidates = [];

  for (const session of sessions) {
    const state = await getSessionState(session.id);
    const dailyCount = await getSessionDailyCount(session.id);
    if (isSessionAvailable(session, state, dailyCount)) {
      candidates.push({ session, state, dailyCount });
    }
  }

  if (!candidates.length) {
    const err = new Error(
      'All Instagram sessions are cooling down or over daily limit. Try again later or use async jobs.'
    );
    err.retryable = true;
    err.retryAfterSeconds = 300;
    throw err;
  }

  candidates.sort((a, b) => a.dailyCount - b.dailyCount);
  const { session } = candidates[0];

  const count = await incrementSessionDailyCount(session.id);
  await saveSessionState(session.id, {
    ...(await getSessionState(session.id)),
    status: 'active',
    request_count_today: count,
    last_used_at: new Date().toISOString(),
  });

  return {
    id: session.id,
    cookiesPath: session.cookiesPath,
    cookieHeader: loadCookieHeaderFromFile(session.cookiesPath),
    dailyCount: count,
    maxDaily: session.maxDaily,
  };
}

async function recordSessionSuccess(sessionId) {
  const state = await getSessionState(sessionId);
  await saveSessionState(sessionId, {
    ...state,
    failed_count: 0,
    status: 'active',
    last_used_at: new Date().toISOString(),
  });
}

async function recordSessionFailure(sessionId, reason = '') {
  const state = await getSessionState(sessionId);
  const failedCount = (state.failed_count || 0) + 1;
  const updates = {
    ...state,
    failed_count: failedCount,
    last_used_at: new Date().toISOString(),
  };

  if (failedCount >= MAX_FAILURES) {
    updates.status = 'blocked';
    updates.cooldown_until = Date.now() + COOLDOWN_MINUTES * 60 * 1000;
    console.warn(`[sessionPool] Session ${sessionId} blocked after ${failedCount} failures: ${reason}`);
  } else {
    updates.status = 'cooldown';
    updates.cooldown_until = Date.now() + COOLDOWN_MINUTES * 60 * 1000;
    console.warn(`[sessionPool] Session ${sessionId} cooldown ${COOLDOWN_MINUTES}min: ${reason}`);
  }

  await saveSessionState(sessionId, updates);
}

async function poolStats() {
  const stats = [];

  for (const session of sessions) {
    const state = await getSessionState(session.id);
    const dailyCount = await getSessionDailyCount(session.id);
    stats.push({
      session_id: session.id,
      platform: 'instagram',
      status: state.status,
      request_count_today: dailyCount,
      max_daily: session.maxDaily,
      last_used_at: state.last_used_at,
      cooldown_until: state.cooldown_until
        ? new Date(state.cooldown_until).toISOString()
        : null,
      failed_count: state.failed_count,
      available: isSessionAvailable(session, state, dailyCount),
    });
  }

  return {
    total: sessions.length,
    available: stats.filter((s) => s.available).length,
    sessions: stats,
  };
}

module.exports = {
  initSessionPool,
  acquireSession,
  recordSessionSuccess,
  recordSessionFailure,
  poolStats,
};
