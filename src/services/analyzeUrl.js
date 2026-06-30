const { getFromCache, saveCache } = require('./cache');
const { getReel, getPost, normalizePostUrl } = require('./igScraper');
const { downloadQueue, sessionQueue } = require('./requestQueue');
const { dedupedRun } = require('./inFlightDedup');
const { normalizeUrl } = require('../utils/normalizeUrl');
const {
  isSessionFallbackEnabled,
  assertPublicScope,
  createPublicScopeError,
} = require('../utils/scopeErrors');
const { enrichWithCdn } = require('./storage');
const { enqueueAnalyzeJob } = require('./jobQueue');
const { cooldownRemainingSeconds, isInCooldown, triggerCooldown } = require('./sessionCooldown');

const PUBLIC_OPTS = { useCookies: false };
const SYNC_QUEUE_LIMIT = parseInt(process.env.SYNC_QUEUE_LIMIT || '200', 10);

function mapYtDlpPostInfo(info) {
  if (info.entries?.length > 0) {
    return {
      type: 'carousel',
      count: info.entries.length,
      items: info.entries.map((e, i) => ({
        index: i + 1,
        url: e.url,
        thumbnail: e.thumbnail,
        ext: e.ext,
        type: e.ext === 'mp4' ? 'video' : 'image',
      })),
    };
  }

  return {
    type: info.ext === 'mp4' ? 'video' : 'image',
    url: info.url,
    thumbnail: info.thumbnail,
    ext: info.ext,
    title: info.title,
  };
}

function shouldForceAsync() {
  const stats = downloadQueue.stats();
  const sessionStats = sessionQueue.stats();
  return stats.queued + sessionStats.queued + stats.running + sessionStats.running >= SYNC_QUEUE_LIMIT;
}

async function runPublicExtract(url, mode) {
  const pageUrl = mode === 'post' ? normalizePostUrl(url) : url;
  assertPublicScope(pageUrl);

  if (mode === 'post') {
    return getPost(pageUrl, PUBLIC_OPTS);
  }
  return getReel(url, PUBLIC_OPTS);
}

async function runSessionFallback(url, mode, sessionid) {
  const { getInfo } = require('./ytdlp');
  const { acquireSession, recordSessionSuccess, recordSessionFailure } = require('./sessionPool');

  if (isInCooldown()) {
    const err = new Error(
      `Service is temporarily rate-limited. Try again in ${cooldownRemainingSeconds()}s.`
    );
    err.retryable = true;
    throw err;
  }

  const pageUrl = mode === 'post' ? normalizePostUrl(url) : url;
  const ytdlpArgs = mode === 'post' ? ['--format', 'b'] : [];
  let poolSession = null;

  try {
    poolSession = await acquireSession();
    const info = await sessionQueue.run(() =>
      getInfo(pageUrl, ytdlpArgs, {
        sessionid,
        cookieFile: poolSession.cookiesPath,
      })
    );

    await recordSessionSuccess(poolSession.id);

    if (mode === 'post') {
      return { ...mapYtDlpPostInfo(info), source: 'session', sessionId: poolSession.id };
    }

    return {
      title: info.title || 'reel',
      thumbnail: info.thumbnail,
      duration: info.duration,
      url: info.url,
      ext: info.ext || 'mp4',
      source: 'session',
      sessionId: poolSession.id,
    };
  } catch (sessionErr) {
    if (poolSession) {
      await recordSessionFailure(poolSession.id, sessionErr.message);
    }
    if ((sessionErr.message || '').toLowerCase().includes('rate')) {
      triggerCooldown(5, sessionErr.message);
    }
    const err = new Error('This content could not be accessed right now.');
    err.retryable = true;
    err.details = sessionErr.message;
    throw err;
  }
}

async function doAnalyze(url, { mode = 'reel', sessionid } = {}) {
  try {
    const result = await downloadQueue.run(() => runPublicExtract(url, mode));
    const enriched = await enrichWithCdn({ ...result, source: 'public' });
    return enriched;
  } catch (publicErr) {
    console.warn(`[analyzeUrl] Public extraction failed for ${url}: ${publicErr.message}`);

    if (!isSessionFallbackEnabled()) {
      throw createPublicScopeError(publicErr);
    }

    const result = await runSessionFallback(url, mode, sessionid);
    return enrichWithCdn(result);
  }
}

async function analyzeUrl(rawUrl, { mode = 'reel', sessionid, asyncOnly = false, fromWorker = false } = {}) {
  const url = normalizeUrl(rawUrl);
  const pageUrl = mode === 'post' ? normalizePostUrl(url) : url;
  const cacheKey = `${mode}:${pageUrl}`;

  const cached = await getFromCache(cacheKey);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  if (
    !fromWorker &&
    (asyncOnly || (process.env.FORCE_ASYNC_JOBS === 'true' && shouldForceAsync()))
  ) {
    const jobId = await enqueueAnalyzeJob({ url: pageUrl, mode, sessionid });
    return {
      status: 'queued',
      jobId,
      pollUrl: `/api/jobs/${jobId}`,
      retryable: true,
    };
  }

  const result = await dedupedRun(cacheKey, async () => {
    const analyzed = await doAnalyze(pageUrl, { mode, sessionid });
    await saveCache(cacheKey, analyzed);
    return analyzed;
  });

  return result;
}

module.exports = { analyzeUrl, shouldForceAsync, isSessionFallbackEnabled };
