const { getFromCache, saveCache } = require('./cache');
const { getReel, getPost, normalizePostUrl } = require('./igScraper');
const { downloadQueue } = require('./requestQueue');
const { dedupedRun } = require('./inFlightDedup');
const { normalizeUrl } = require('../utils/normalizeUrl');
const {
  assertPublicScope,
  createPublicScopeError,
} = require('../utils/scopeErrors');
const { enrichWithCdn } = require('./storage');
const { enqueueAnalyzeJob } = require('./jobQueue');
const SYNC_QUEUE_LIMIT = parseInt(process.env.SYNC_QUEUE_LIMIT || '200', 10);

function shouldForceAsync() {
  const stats = downloadQueue.stats();
  return stats.queued + stats.running >= SYNC_QUEUE_LIMIT;
}

async function runPublicExtract(url, mode) {
  const pageUrl = mode === 'post' ? normalizePostUrl(url) : url;
  assertPublicScope(pageUrl);

  if (mode === 'post') {
    return getPost(pageUrl);
  }
  return getReel(url);
}

async function doAnalyze(url, { mode = 'reel' } = {}) {
  try {
    const result = await downloadQueue.run(() => runPublicExtract(url, mode));
    const enriched = await enrichWithCdn({ ...result, source: 'public' });
    return enriched;
  } catch (publicErr) {
    console.warn(`[analyzeUrl] Public extraction failed for ${url}: ${publicErr.message}`);
    throw createPublicScopeError(publicErr);
  }
}

async function analyzeUrl(rawUrl, { mode = 'reel', asyncOnly = false, fromWorker = false } = {}) {
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
    const jobId = await enqueueAnalyzeJob({ url: pageUrl, mode });
    return {
      status: 'queued',
      jobId,
      pollUrl: `/api/jobs/${jobId}`,
      retryable: true,
    };
  }

  const result = await dedupedRun(cacheKey, async () => {
    const analyzed = await doAnalyze(pageUrl, { mode });
    await saveCache(cacheKey, analyzed);
    return analyzed;
  });

  return result;
}

module.exports = { analyzeUrl, shouldForceAsync };
