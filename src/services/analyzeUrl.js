const { getFromCache, saveCache } = require('./cache');
const { getReel, getPost, normalizePostUrl } = require('./igScraper');
const { getInfo } = require('./ytdlp');
const { downloadQueue, sessionQueue } = require('./requestQueue');
const { isInCooldown, triggerCooldown, cooldownRemainingSeconds } = require('./sessionCooldown');

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

async function analyzeUrl(url, { mode = 'reel', sessionid } = {}) {
  const pageUrl = mode === 'post' ? normalizePostUrl(url) : url;
  const cacheKey = `${mode}:${pageUrl}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  const publicExtract =
    mode === 'post' ? () => getPost(pageUrl) : () => getReel(url);

  try {
    const result = await downloadQueue.run(publicExtract);
    const enriched = { ...result, source: 'public' };
    saveCache(cacheKey, enriched);
    return enriched;
  } catch (publicErr) {
    console.warn(`[analyzeUrl] Public extraction failed for ${pageUrl}: ${publicErr.message}`);

    if (isInCooldown()) {
      const err = new Error(
        `Service is temporarily rate-limited. Try again in ${cooldownRemainingSeconds()}s.`
      );
      err.retryable = true;
      err.retryAfterSeconds = cooldownRemainingSeconds();
      throw err;
    }

    try {
      const ytdlpArgs = mode === 'post' ? ['--format', 'b'] : [];
      const info = await sessionQueue.run(() => getInfo(pageUrl, ytdlpArgs, { sessionid }));

      const result =
        mode === 'post'
          ? { ...mapYtDlpPostInfo(info), source: 'session' }
          : {
              title: info.title || 'reel',
              thumbnail: info.thumbnail,
              duration: info.duration,
              url: info.url,
              source: 'session',
            };

      saveCache(cacheKey, result);
      return result;
    } catch (sessionErr) {
      console.error(`[analyzeUrl] Session fallback failed for ${pageUrl}: ${sessionErr.message}`);

      if (isAuthError(sessionErr)) {
        triggerCooldown(5, sessionErr.message);
      }

      const err = new Error(
        'Could not extract media. The source may be blocking requests right now.'
      );
      err.retryable = true;
      err.details = sessionErr.message;
      throw err;
    }
  }
}

module.exports = { analyzeUrl };
