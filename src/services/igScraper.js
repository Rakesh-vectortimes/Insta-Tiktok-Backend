const axios = require('axios');
const {
  igAxios,
  chromeDocumentHeaders,
  chromeApiHeaders,
  iphoneHeaders,
} = require('../utils/igHttp');

const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
];

// Instagram only embeds media JSON on mobile UA; desktop/Android UAs return a login SPA shell.
const EMBED_USER_AGENT = iphoneHeaders()['User-Agent'];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function igHeaders() {
  return {
    'User-Agent': randomUA(),
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-IG-App-ID': '936619743392459',
  };
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

function extractLsdToken(html) {
  const match =
    html.match(/"LSD",\[\],\{"token":"([^"]+)"/) ||
    html.match(/"lsd":"([^"]+)"/);
  return match?.[1] || null;
}

function cookiesFromSetCookie(setCookie = []) {
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

function parseGraphqlProduct(product) {
  if (!product) return null;

  if (product.carousel_media?.length) {
    const items = product.carousel_media
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
      title: product.caption?.text,
      author: product.user?.username,
    };
  }

  const parsed = parseMediaNode(product);
  if (!parsed) return null;

  return {
    type: parsed.type,
    url: parsed.url,
    thumbnail: parsed.thumbnail,
    ext: parsed.ext,
    title: parsed.title,
    duration: parsed.duration,
    videoVersions: parsed.videoVersions,
    author: product.user?.username || product.owner?.username,
  };
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

function isVideoMediaNode(node) {
  return !!(
    node?.is_video ||
    node?.__typename === 'GraphVideo' ||
    node?.media_type === 2 ||
    node?.video_url ||
    node?.video_versions?.length ||
    node?.product_type === 'clips'
  );
}

function isValidMediaUrl(url) {
  if (!url || url.length > 2048) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/[{}[\]\\]/.test(url)) return false;
  return true;
}

function extractEscapedFieldUrl(html, field) {
  const escaped = new RegExp(`\\\\"${field}\\\\":\\\\"(https:(?:\\\\\\\\/|[^"\\\\])+)\\\\"`);
  const plain = new RegExp(`"${field}":"(https:(?:[^"\\\\]|\\\\.)+)"`);
  const match = html.match(escaped) || html.match(plain);
  if (!match?.[1]) return null;
  const url = decodeJsonString(match[1]);
  return isValidMediaUrl(url) ? url : null;
}

function decodeJsonString(value) {
  let decoded;
  try {
    decoded = JSON.parse(`"${value}"`);
  } catch {
    decoded = value
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\\\/g, '\\');
  }
  return String(decoded).replace(/\\\//g, '/');
}

function embedHeaders() {
  return {
    'User-Agent': EMBED_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function extractContextJsonRaw(html) {
  const marker = '"contextJSON":"';
  const start = html.indexOf(marker);
  if (start === -1) return null;

  let i = start + marker.length;
  let raw = '';

  while (i < html.length) {
    const ch = html[i];
    if (ch === '\\' && i + 1 < html.length) {
      raw += ch + html[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') break;
    raw += ch;
    i += 1;
  }

  return raw || null;
}

function parseEmbedContextJson(html) {
  const raw = extractContextJsonRaw(html);
  if (!raw) return null;

  try {
    const unescaped = JSON.parse(`"${raw}"`);
    const parsed = JSON.parse(unescaped);
    const media = parsed?.gql_data?.shortcode_media;
    if (!media) return null;

    const result = parseMediaNode(media);
    if (result) return result;

    if (isVideoMediaNode(media)) {
      return null;
    }

    return null;
  } catch (err) {
    console.warn('[scraper] contextJSON parse failed:', err.message);
    return null;
  }
}

function extractCdnMediaFromHtml(html) {
  const patterns = [
    /property="og:video:secure_url" content="([^"]+)"/,
    /property="og:video" content="([^"]+)"/,
    /"video_url":"((?:\\.|[^"\\])*)"/,
    /"playback_url":"((?:\\.|[^"\\])*)"/,
    /(https:\/\/[^"\\]*?cdninstagram\.com[^"\\]*?\.mp4[^"\\]*)/,
    /(https:\\\/\\\/[^"\\]*?cdninstagram\.com[^"\\]*?\.mp4[^"\\]*)/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const url = decodeJsonString(match[1]);
    if (/\.mp4/i.test(url) || pattern.source.includes('video')) {
      return url;
    }
  }
  return null;
}

async function fetchPageHtml(pageUrl) {
  const { data, status } = await igAxios.get(pageUrl, {
    headers: chromeDocumentHeaders(),
  });

  if (status !== 200) {
    throw new Error(`Page fetch returned status ${status}`);
  }

  return String(data);
}

async function fetchPageMeta(pageUrl) {
  const html = await fetchPageHtml(pageUrl);
  const videoUrl = extractCdnMediaFromHtml(html);
  const imageMatch = html.match(/property="og:image" content="([^"]+)"/);

  if (videoUrl) {
    return {
      type: 'video',
      url: videoUrl,
      ext: 'mp4',
      thumbnail: imageMatch?.[1],
    };
  }

  if (imageMatch) {
    throw new Error('Page exposes thumbnail only (video requires login)');
  }

  throw new Error('No Open Graph media found on page');
}

function parseEmbedHtmlFallback(html) {
  const videoUrl = extractEscapedFieldUrl(html, 'video_url');
  const displayUrl = extractEscapedFieldUrl(html, 'display_url');

  if (videoUrl) {
    return {
      type: 'video',
      url: videoUrl,
      ext: 'mp4',
      thumbnail: displayUrl,
    };
  }

  if (displayUrl) {
    return { type: 'image', url: displayUrl, ext: 'jpg', thumbnail: displayUrl };
  }

  return null;
}

async function fetchEmbedHtml(shortcode) {
  const embedPaths = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
  ];

  let lastError = null;

  for (const embedUrl of embedPaths) {
    try {
      const { data, status } = await igAxios.get(embedUrl, {
        headers: embedHeaders(),
        timeout: 15000,
      });

      if (status !== 200) {
        lastError = new Error(`Embed returned status ${status}`);
        continue;
      }

      const html = String(data);

      const fromContext = parseEmbedContextJson(html);
      if (fromContext) return fromContext;

      if (html.includes('contextJSON') && /"is_video":true|"__typename":"GraphVideo"/.test(html)) {
        lastError = new Error('Video URL not available in public embed');
      }

      const fromRegex = parseEmbedHtmlFallback(html);
      if (fromRegex) return fromRegex;

      const videoUrl = extractCdnMediaFromHtml(html);
      if (videoUrl) {
        return { type: 'video', url: videoUrl, ext: 'mp4' };
      }

      lastError = new Error('Could not parse embed HTML');
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Could not parse embed HTML');
}

async function fetchPolarisGraphql(pageUrl) {
  const shortcode = extractShortcode(pageUrl);
  if (!shortcode) throw new Error('Invalid Instagram URL');

  const mediaId = shortcodeToMediaId(shortcode);
  const pageRes = await igAxios.get(pageUrl, {
    headers: chromeDocumentHeaders(),
  });

  if (pageRes.status !== 200) {
    throw new Error(`Page fetch returned status ${pageRes.status}`);
  }

  const html = String(pageRes.data);
  const lsd = extractLsdToken(html);
  if (!lsd) throw new Error('GraphQL token not found on page');

  const cookieHeader = cookiesFromSetCookie(pageRes.headers['set-cookie']);
  const csrf = cookieHeader.match(/csrftoken=([^;]+)/)?.[1] || '';
  const gqlHeaders = {
    ...chromeApiHeaders(pageUrl),
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-FB-Friendly-Name': 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
    'X-CSRFToken': csrf,
    'X-FB-LSD': lsd,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  const queries = [
    {
      variables: { media_id: mediaId },
      doc_id: '27130156389949648',
    },
    {
      variables: { shortcode },
      doc_id: '8845758582119845',
    },
  ];

  let lastError = new Error('GraphQL returned no media URL');

  for (const query of queries) {
    const body = new URLSearchParams({
      av: '0',
      __d: 'www',
      __user: '0',
      dpr: '1',
      lsd,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
      server_timestamps: 'true',
      variables: JSON.stringify(query.variables),
      doc_id: query.doc_id,
    });

    const gqlRes = await igAxios.post('https://www.instagram.com/api/graphql', body.toString(), {
      headers: gqlHeaders,
    });

    if (gqlRes.status !== 200 || typeof gqlRes.data !== 'object') {
      lastError = new Error('GraphQL request blocked');
      continue;
    }

    const product =
      gqlRes.data?.data?.xig_polaris_media?.if_not_gated_logged_out ||
      gqlRes.data?.data?.xdt_shortcode_media ||
      gqlRes.data?.data?.shortcode_media;

    const media = parseGraphqlProduct(product);
    if (media) return media;
    lastError = new Error('GraphQL returned no media URL');
  }

  throw lastError;
}

async function fetchPublicYtdlp(pageUrl) {
  const { getInfo } = require('./ytdlp');
  const info = await getInfo(pageUrl, ['--format', 'b']);

  if (info.entries?.length) {
    const items = info.entries
      .map((entry, i) => {
        if (!entry.url) return null;
        return {
          index: i + 1,
          type: entry.ext === 'mp4' ? 'video' : 'image',
          url: entry.url,
          thumbnail: entry.thumbnail,
          ext: entry.ext || 'jpg',
        };
      })
      .filter(Boolean);

    if (!items.length) throw new Error('yt-dlp returned no media URL');

    if (items.length === 1) {
      return {
        type: items[0].type,
        url: items[0].url,
        thumbnail: items[0].thumbnail,
        ext: items[0].ext,
        title: info.title,
      };
    }

    return { type: 'carousel', count: items.length, items, title: info.title };
  }

  if (!info.url) throw new Error('yt-dlp returned no media URL');

  return {
    type: info.ext === 'mp4' ? 'video' : 'image',
    url: info.url,
    thumbnail: info.thumbnail,
    ext: info.ext || 'mp4',
    title: info.title,
    duration: info.duration,
  };
}

async function scrapeInstagram(pageUrl) {
  const normalized = normalizePostUrl(pageUrl);
  const shortcode = extractShortcode(normalized);
  if (!shortcode) throw new Error('Invalid Instagram URL');

  let media = null;
  const errors = [];

  const tryStep = async (label, fn) => {
    if (media) return;
    try {
      media = await fn();
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
    }
  };

  await tryStep('embed', () => fetchEmbedHtml(shortcode));
  await tryStep('page', () => fetchPageMeta(normalized));
  await tryStep('graphql', () => fetchPolarisGraphql(normalized));
  await tryStep('ytdlp', () => fetchPublicYtdlp(normalized));

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

async function getReel(pageUrl) {
  const media = await scrapeInstagram(pageUrl);

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

async function getPost(pageUrl) {
  return scrapeInstagram(pageUrl);
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
