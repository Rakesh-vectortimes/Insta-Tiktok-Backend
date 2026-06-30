const axios = require('axios');
const path = require('path');
const { loadCookieHeader, hasCookieFile } = require('../utils/cookies');

const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function igHeaders({ useCookies = true, cookieFile, cookieHeader } = {}) {
  const headers = {
    'User-Agent': randomUA(),
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-IG-App-ID': '936619743392459',
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  } else if (useCookies) {
    const cookie = cookieFile
      ? require('../utils/cookies').loadCookieHeaderFromFile(cookieFile)
      : loadCookieHeader();
    if (cookie) {
      headers.Cookie = cookie;
      const label = cookieFile ? path.basename(cookieFile) : require('../utils/cookies').getCookieFile().split(/[/\\]/).pop();
      console.log('[scraper] Using cookies from', label);
    } else if (!hasCookieFile()) {
      console.warn('[scraper] No cookies.txt — Instagram may block this IP');
    }
  }

  return headers;
}

function extractShortcode(url) {
  const match = url.match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] || null;
}

function normalizePostUrl(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) return url;
  if (/instagram\.com\/(?:reel|reels)\//i.test(url)) {
    return `https://www.instagram.com/reel/${shortcode}/`;
  }
  return `https://www.instagram.com/p/${shortcode}/`;
}

function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = 0n;
  for (const char of shortcode) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid Instagram shortcode');
    id = id * 64n + BigInt(index);
  }
  return id.toString();
}

function isInstagramPageUrl(url) {
  return /instagram\.com\/(?:reel|reels|p)\//i.test(url);
}

function pickVideoByQuality(versions, quality) {
  if (!versions?.length) return null;
  const sorted = [...versions].sort(
    (a, b) => (b.height || b.width || 0) - (a.height || a.width || 0)
  );
  const match = sorted.find((v) => (v.height || v.width || 0) <= quality);
  return (match || sorted[sorted.length - 1]).url;
}

function parseMediaNode(node) {
  if (!node) return null;

  const videoVersions = node.video_versions?.map((v) => ({
    url: v.url,
    width: v.width,
    height: v.height,
  }));

  const isVideo =
    node.is_video ||
    node.media_type === 2 ||
    !!node.video_url ||
    !!videoVersions?.length;

  let mediaUrl;
  if (isVideo) {
    mediaUrl =
      pickVideoByQuality(videoVersions, 1080) ||
      node.video_url ||
      videoVersions?.[0]?.url;
  } else {
    mediaUrl =
      node.display_url ||
      node.image_versions2?.candidates?.[0]?.url ||
      node.thumbnail_src;
  }

  if (!mediaUrl) return null;

  const title =
    node.caption?.text ||
    node.edge_media_to_caption?.edges?.[0]?.node?.text ||
    node.title;

  return {
    type: isVideo ? 'video' : 'image',
    url: mediaUrl,
    thumbnail:
      node.thumbnail_src ||
      node.display_url ||
      node.image_versions2?.candidates?.[0]?.url,
    ext: isVideo ? 'mp4' : 'jpg',
    title,
    duration: node.video_duration,
    videoVersions,
  };
}

function parseGraphQLMedia(data) {
  const media =
    data?.items?.[0] ||
    data?.graphql?.shortcode_media ||
    data?.data?.xdt_shortcode_media;

  if (!media) return null;

  const sidecar =
    media.edge_sidecar_to_children?.edges ||
    media.carousel_media ||
    media.children?.data;

  if (sidecar?.length) {
    const items = sidecar
      .map((edge, i) => {
        const parsed = parseMediaNode(edge.node || edge);
        return parsed ? { index: i + 1, ...parsed } : null;
      })
      .filter(Boolean);

    if (!items.length) return null;
    return { type: 'carousel', count: items.length, items };
  }

  const parsed = parseMediaNode(media);
  if (!parsed) return null;

  return {
    type: parsed.type,
    url: parsed.url,
    thumbnail: parsed.thumbnail,
    ext: parsed.ext,
    title: parsed.title,
    duration: parsed.duration,
    videoVersions: parsed.videoVersions,
    author: media.owner?.username || media.user?.username,
  };
}

async function fetchOEmbed(pageUrl) {
  try {
    const { data } = await axios.get(
      `https://www.instagram.com/oembed/?url=${encodeURIComponent(pageUrl)}`,
      { headers: { 'User-Agent': randomUA() }, timeout: 10000 }
    );
    return {
      title: data.title,
      thumbnail: data.thumbnail_url,
      author: data.author_name,
    };
  } catch {
    return null;
  }
}

async function fetchMediaApi(shortcode, headerOptions = {}) {
  const mediaId = shortcodeToMediaId(shortcode);
  const { data, status } = await axios.get(
    `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
    {
      headers: igHeaders(headerOptions),
      timeout: 15000,
      validateStatus: (s) => s < 500,
    }
  );

  if (status !== 200 || !data?.items?.[0]) {
    throw new Error(`Media API returned status ${status}`);
  }

  return data.items[0];
}

function parseApiItem(item) {
  if (item.carousel_media?.length) {
    const items = item.carousel_media
      .map((node, i) => {
        const parsed = parseMediaNode(node);
        return parsed ? { index: i + 1, ...parsed } : null;
      })
      .filter(Boolean);

    if (!items.length) return null;

    return {
      type: 'carousel',
      count: items.length,
      items,
      title: item.caption?.text,
      author: item.user?.username,
    };
  }

  const parsed = parseMediaNode(item);
  if (!parsed) return null;

  return {
    type: parsed.type,
    url: parsed.url,
    thumbnail: parsed.thumbnail,
    ext: parsed.ext,
    title: parsed.title || item.caption?.text,
    duration: parsed.duration,
    videoVersions: parsed.videoVersions,
    author: item.user?.username,
  };
}

async function fetchEmbedHtml(shortcode, headerOptions = {}) {
  const { data } = await axios.get(
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    {
      headers: { ...igHeaders(headerOptions), Accept: 'text/html' },
      timeout: 15000,
    }
  );

  const html = String(data);
  const videoMatch = html.match(/"video_url":"([^"]+)"/);
  const imageMatch = html.match(/"display_url":"([^"]+)"/);

  if (videoMatch) {
    const url = JSON.parse(`"${videoMatch[1]}"`);
    return {
      type: 'video',
      url,
      ext: 'mp4',
      thumbnail: imageMatch ? JSON.parse(`"${imageMatch[1]}"`) : undefined,
    };
  }

  if (imageMatch) {
    const url = JSON.parse(`"${imageMatch[1]}"`);
    return { type: 'image', url, ext: 'jpg', thumbnail: url };
  }

  throw new Error('Could not parse embed HTML');
}

async function fetchGraphQL(shortcode, headerOptions = {}) {
  const embedUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
  const { data, status } = await axios.get(embedUrl, {
    headers: igHeaders(headerOptions),
    timeout: 15000,
    validateStatus: (s) => s < 500,
  });

  if (status !== 200 || !data || typeof data !== 'object') {
    throw new Error('GraphQL embed returned no data');
  }

  const parsed = parseGraphQLMedia(data);
  if (!parsed) throw new Error('Could not parse Instagram media');
  return parsed;
}

async function scrapeInstagram(pageUrl, options = {}) {
  const normalized = normalizePostUrl(pageUrl);
  const shortcode = extractShortcode(normalized);
  if (!shortcode) throw new Error('Invalid Instagram URL');

  let media = null;
  const errors = [];

  try {
    media = parseApiItem(await fetchMediaApi(shortcode, options));
  } catch (err) {
    errors.push(`api: ${err.message}`);
  }

  if (!media) {
    try {
      media = await fetchGraphQL(shortcode, options);
    } catch (err) {
      errors.push(`graphql: ${err.message}`);
    }
  }

  if (!media) {
    try {
      media = await fetchEmbedHtml(shortcode, options);
    } catch (err) {
      errors.push(`embed: ${err.message}`);
    }
  }

  if (!media) {
    throw new Error(`Could not fetch post (${errors.join('; ')})`);
  }

  const oembed = await fetchOEmbed(normalized);
  if (oembed) {
    media.title = media.title || oembed.title;
    media.thumbnail = media.thumbnail || oembed.thumbnail;
    media.author = media.author || oembed.author;
  }

  media.source = 'scraper';
  media.pageUrl = normalized;
  media.shortcode = shortcode;
  return media;
}

async function getReel(pageUrl, options = {}) {
  const media = await scrapeInstagram(pageUrl, options);

  if (media.type === 'carousel') {
    const video = media.items.find((item) => item.type === 'video');
    if (!video) throw new Error('No video found in carousel');
    return {
      ...video,
      pageUrl: media.pageUrl,
      source: 'scraper',
      shortcode: media.shortcode,
    };
  }

  if (media.type !== 'video') {
    throw new Error('URL is not a video reel');
  }

  return media;
}

async function getPost(pageUrl, options = {}) {
  return scrapeInstagram(pageUrl, options);
}

async function proxyMediaStream(mediaUrl, res, filename, contentType = 'video/mp4') {
  const response = await axios.get(mediaUrl, {
    responseType: 'stream',
    headers: {
      'User-Agent': randomUA(),
      Referer: 'https://www.instagram.com/',
    },
    timeout: 120000,
  });

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);
  response.data.pipe(res);
}

function isDirectMediaUrl(url) {
  return /cdninstagram\.com|fbcdn\.net/i.test(url);
}

async function downloadDirect(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'stream',
    headers: {
      'User-Agent': randomUA(),
      Referer: 'https://www.instagram.com/',
    },
    timeout: 120000,
  });

  const fs = require('fs');
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  return outputPath;
}

module.exports = {
  scrapeInstagram,
  getReel,
  getPost,
  pickVideoByQuality,
  proxyMediaStream,
  downloadToTemp: downloadDirect,
  downloadDirect,
  isDirectMediaUrl,
  normalizePostUrl,
  isInstagramPageUrl,
};
