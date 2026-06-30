const {
  getVideoCache,
  setVideoCache,
  clearJobLock,
  CACHE_TTL_SECONDS,
} = require('./videoCache');
const {
  extractWithoutSession,
  downloadFileBuffer,
} = require('./mediaExtractor');
const { uploadToR2, isStorageEnabled } = require('./storage');
const { createPublicScopeError } = require('../utils/scopeErrors');

async function processDownloadJob({ url, hash }) {
  const cached = await getVideoCache(hash);
  if (cached) return cached;

  let media;

  try {
    media = await extractWithoutSession(url);
  } catch (publicErr) {
    console.warn(`[downloadProcessor] Public extract failed: ${publicErr.message}`);
    throw createPublicScopeError(publicErr);
  }

  const ext = media.ext || 'mp4';
  const fileName = `${hash}.${ext}`;
  let downloadUrl = media.videoUrl;

  if (isStorageEnabled()) {
    const referer =
      media.platform === 'tiktok'
        ? 'https://www.tiktok.com/'
        : 'https://www.instagram.com/';
    const buffer = await downloadFileBuffer(media.videoUrl, referer);
    downloadUrl = await uploadToR2(fileName, buffer, ext);
  }

  const result = {
    source_url: url,
    title: media.title || '',
    thumbnail: media.thumbnail || '',
    download_url: downloadUrl,
    platform: media.platform,
    extraction: media.extraction,
    cached_until_hours: Math.round(CACHE_TTL_SECONDS / 3600),
  };

  await setVideoCache(hash, result);
  await clearJobLock(hash);

  return result;
}

module.exports = { processDownloadJob };
