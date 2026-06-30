const axios = require('axios');
const { getReel, getPost, normalizePostUrl, pickVideoByQuality } = require('./igScraper');
const { getInfo } = require('./ytdlp');
const { parseUrl } = require('./urlParser');
const {
  acquireSession,
  recordSessionSuccess,
  recordSessionFailure,
} = require('./sessionPool');

const PUBLIC_OPTS = { useCookies: false };

function pickMediaUrl(media) {
  if (media.type === 'carousel') {
    const video = media.items?.find((item) => item.type === 'video');
    if (video?.url) {
      return {
        videoUrl: video.url,
        title: media.title,
        thumbnail: video.thumbnail || media.thumbnail,
        ext: video.ext || 'mp4',
      };
    }
    const first = media.items?.[0];
    if (first?.url) {
      return {
        videoUrl: first.url,
        title: media.title,
        thumbnail: first.thumbnail,
        ext: first.ext || 'jpg',
      };
    }
  }

  if (media.videoVersions?.length) {
    const videoUrl = pickVideoByQuality(media.videoVersions, 1080) || media.url;
    return {
      videoUrl,
      title: media.title,
      thumbnail: media.thumbnail,
      ext: 'mp4',
    };
  }

  return {
    videoUrl: media.url,
    title: media.title,
    thumbnail: media.thumbnail,
    ext: media.ext || (media.type === 'video' ? 'mp4' : 'jpg'),
  };
}

async function extractWithoutSession(url) {
  const parsed = parseUrl(url);

  if (!parsed) {
    throw new Error('Unsupported or invalid URL');
  }

  if (parsed.platform === 'instagram') {
    const isReel = parsed.type === 'reel';
    const media = isReel
      ? await getReel(url, PUBLIC_OPTS)
      : await getPost(normalizePostUrl(url), PUBLIC_OPTS);

    const picked = pickMediaUrl(media);
    if (!picked.videoUrl) throw new Error('No media URL found');

    return {
      ...picked,
      platform: 'instagram',
      extraction: 'public',
    };
  }

  if (parsed.platform === 'tiktok') {
    const info = await getInfo(url, ['--format', 'bestvideo+bestaudio/best']);
    if (!info.url) throw new Error('No TikTok media URL found');

    return {
      videoUrl: info.url,
      title: info.title,
      thumbnail: info.thumbnail,
      ext: info.ext || 'mp4',
      platform: 'tiktok',
      extraction: 'public',
    };
  }

  throw new Error('Unsupported platform');
}

async function extractWithSessionFallback(url) {
  const parsed = parseUrl(url);
  if (!parsed) throw new Error('Unsupported or invalid URL');

  const poolSession = await acquireSession();

  try {
    const formatArgs =
      parsed.platform === 'instagram' && parsed.type !== 'reel'
        ? ['--format', 'b']
        : ['--format', 'bestvideo+bestaudio/best'];

    const pageUrl =
      parsed.platform === 'instagram' ? normalizePostUrl(url) : url;

    const info = await getInfo(pageUrl, formatArgs, {
      cookieFile: poolSession.cookiesPath,
    });

    await recordSessionSuccess(poolSession.id);

    if (info.entries?.length) {
      const entry = info.entries.find((e) => e.ext === 'mp4') || info.entries[0];
      return {
        videoUrl: entry.url,
        title: info.title,
        thumbnail: entry.thumbnail || info.thumbnail,
        ext: entry.ext || 'mp4',
        platform: parsed.platform,
        extraction: 'session',
        sessionId: poolSession.id,
      };
    }

    return {
      videoUrl: info.url,
      title: info.title,
      thumbnail: info.thumbnail,
      ext: info.ext || 'mp4',
      platform: parsed.platform,
      extraction: 'session',
      sessionId: poolSession.id,
    };
  } catch (err) {
    await recordSessionFailure(poolSession.id, err.message);
    throw err;
  }
}

async function downloadFileBuffer(mediaUrl, referer = 'https://www.instagram.com/') {
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: referer,
    },
  });
  return Buffer.from(response.data);
}

module.exports = {
  extractWithoutSession,
  extractWithSessionFallback,
  downloadFileBuffer,
};
