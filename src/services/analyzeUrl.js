const { getFromCache, saveCache } = require('./cache');
const { getReel, getPost, normalizePostUrl } = require('./igScraper');
const { getInfo } = require('./ytdlp');
const { downloadQueue, sessionQueue } = require('./requestQueue');
const { cooldownRemainingSeconds } = require('./sessionCooldown');
const {
  acquireSession,
  recordSessionSuccess,
  recordSessionFailure,
} = require('./sessionPool');
const { enrichWithCdn } = require('./storage');
const { enqueueAnalyzeJob, getJobStatus } = require('./jobQueue');

const PUBLIC_OPTS = { useCookies: false };
const SYNC_QUEUE_LIMIT = parseInt(process.env.SYNC_QUEUE_LIMIT || '200', 10);

function isAuthError(err) {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('login') ||
    msg.includes('rate') ||
    msg.includes('429') ||
    msg.includes('blocked') ||
    msg.includes('auth')
  );
}

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
  const totalQueued = stats.queued + sessionStats.queued + stats.running + sessionStats.running;
  return totalQueued >= SYNC_QUEUE_LIMIT;
}

async function analyzeUrl(url, { mode = 'reel', sessionid, asyncOnly = false, fromWorker = false } = {}) {
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
    const jobId = await enqueueAnalyzeJob({ url, mode, sessionid });
    return {
      status: 'queued',
      jobId,
      pollUrl: `/api/jobs/${jobId}`,
      retryable: true,
    };
  }

  const publicExtract =
    mode === 'post'
      ? () => getPost(pageUrl, PUBLIC_OPTS)
      : () => getReel(url, PUBLIC_OPTS);

  try {
    const result = await downloadQueue.run(publicExtract);
    const enriched = await enrichWithCdn({ ...result, source: 'public' });
    await saveCache(cacheKey, enriched);
    return enriched;
  } catch (publicErr) {
    console.warn(`[analyzeUrl] Public extraction failed for ${pageUrl}: ${publicErr.message}`);

    let poolSession = null;

    try {
      poolSession = await acquireSession();
      const ytdlpArgs = mode === 'post' ? ['--format', 'b'] : [];

      const info = await sessionQueue.run(() =>
        getInfo(pageUrl, ytdlpArgs, {
          sessionid,
          cookieFile: poolSession.cookiesPath,
        })
      );

      const result =
        mode === 'post'
          ? { ...mapYtDlpPostInfo(info), source: 'session', sessionId: poolSession.id }
          : {
              title: info.title || 'reel',
              thumbnail: info.thumbnail,
              duration: info.duration,
              url: info.url,
              ext: info.ext || 'mp4',
              source: 'session',
              sessionId: poolSession.id,
            };

      await recordSessionSuccess(poolSession.id);
      const enriched = await enrichWithCdn(result);
      await saveCache(cacheKey, enriched);
      return enriched;
    } catch (sessionErr) {
      console.error(`[analyzeUrl] Session fallback failed for ${pageUrl}: ${sessionErr.message}`);

      if (poolSession) {
        await recordSessionFailure(poolSession.id, sessionErr.message);
      }

      if (!fromWorker && process.env.REDIS_URL && shouldForceAsync()) {
        const jobId = await enqueueAnalyzeJob({ url, mode, sessionid });
        const err = new Error('High traffic — job queued for background processing');
        err.retryable = true;
        err.jobId = jobId;
        err.pollUrl = `/api/jobs/${jobId}`;
        throw err;
      }

      const err = new Error(
        'Could not extract media. The source may be blocking requests right now.'
      );
      err.retryable = true;
      err.details = sessionErr.message;
      err.retryAfterSeconds = cooldownRemainingSeconds() || 60;
      throw err;
    }
  }
}

module.exports = { analyzeUrl, shouldForceAsync };
