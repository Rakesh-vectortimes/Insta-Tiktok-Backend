const axios = require('axios');
const { getReel, getPost, normalizePostUrl, pickVideoByQuality } = require('./igScraper');
const { getInfo } = require('./ytdlp');
const { parseUrl } = require('./urlParser');
const { assertPublicScope } = require('../utils/scopeErrors');

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
  if (!parsed) throw new Error('Unsupported or invalid URL');

  assertPublicScope(url);

  if (parsed.platform === 'instagram') {
    const isReel = parsed.type === 'reel';
    const media = isReel
      ? await getReel(url)
      : await getPost(normalizePostUrl(url));

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
  downloadFileBuffer,
};
